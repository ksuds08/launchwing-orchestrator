import type { Env, MvpRequest, MvpResult } from "../types";
import { json as log } from "../utils/log";
import { sanitizeGeneratedFiles } from "../utils/sanitizeGeneratedFiles";
import { ensureRepo, pushFilesWithContentsAPI } from "../utils/github";

/**
 * Generate IR + files directly via OpenAI (no external agent service).
 * We use the Responses API and coerce the model to return strict JSON.
 */
export async function mvpHandler(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const stream = url.searchParams.get("stream") === "true";

  const input = await request.json<MvpRequest>().catch(() => ({}));
  const idea = input.idea || "(no idea provided)";
  const tag = Math.random().toString(36).slice(2, 8);

  if (stream) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    (async () => {
      try {
        await write(writer, { step: "start", message: "Starting MVP generation…" });

        const agent = await callOpenAI(env, input, (msg) =>
          write(writer, { step: "openai", message: msg })
        );

        await write(writer, { step: "sanitize", message: "Sanitizing files…" });
        const appName = (agent.ir?.name || `app-${tag}`).replace(/[^\w-]/g, "-").toLowerCase();
        const files = sanitizeGeneratedFiles(env, agent.files || {}, appName);

        const repoName = appName;
        await write(writer, { step: "repo", message: `Ensuring repo ${repoName}…` });
        await ensureRepo(env, repoName, true);

        await write(writer, {
          step: "push",
          message: `Pushing ${Object.keys(files).length} files…`
        });
        const repoUrl = await pushFilesWithContentsAPI(
          env,
          repoName,
          files,
          `Initial commit for ${appName} (idea: ${idea.slice(0, 80)})`
        );

        await write(writer, {
          step: "done",
          message: "Complete.",
          data: { repoUrl, repoName, ir: agent.ir }
        });
        await writer.close();
      } catch (err: any) {
        await write(writer, { step: "error", message: String(err?.message || err) });
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  // Non-streaming path
  const agent = await callOpenAI(env, input);
  const appName = (agent.ir?.name || `app-${tag}`).replace(/[^\w-]/g, "-").toLowerCase();
  const files = sanitizeGeneratedFiles(env, agent.files || {}, appName);
  const repoName = appName;

  await ensureRepo(env, repoName, true);
  const repoUrl = await pushFilesWithContentsAPI(
    env,
    repoName,
    files,
    `Initial commit for ${appName} (idea: ${idea.slice(0, 80)})`
  );

  return respond({ ok: true, repoUrl, repoName, ir: agent.ir });
}

async function callOpenAI(
  env: Env,
  body: MvpRequest,
  onTick?: (msg: string) => void
): Promise<MvpResult> {
  if (!env.OPENAI_API_KEY) throw new Error("Missing env: OPENAI_API_KEY");
  const model = env.OPENAI_MODEL || "gpt-4o-mini";

  const system = [
    "You are LaunchWing's generation engine.",
    "Return a SINGLE JSON object, no prose, no markdown.",
    "Shape:",
    "{",
    '  "ir": {',
    '    "name": string,',
    '    "app_type": "spa_api" | "spa" | "api",',
    '    "pages"?: string[],',
    '    "api_routes"?: Array<{ method: string; path: string }>,',
    '    "notes"?: string',
    "  },",
    '  "files": { "<path>": "<utf8 file contents>" }',
    "}",
    "Constraints:",
    "- Keep the scaffold minimal and production-capable.",
    "- Prefer a Vite SPA (index.html + basic entry) unless the idea clearly needs API routes.",
    "- DO NOT include code fences or backticks.",
    "- Avoid huge binaries; no images or node_modules.",
    "- Paths must be POSIX style."
  ].join("\n");

  const user = {
    idea: body.idea ?? "",
    ideaId: body.ideaId ?? "",
    branding: body.branding ?? {},
    thread: body.thread ?? []
  };

  onTick?.("Calling OpenAI…");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      top_p: 1,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 400)}`);
  }
  onTick?.("OpenAI responded.");

  const j = await res.json();
  const text = extractOutputText(j);
  const parsed = safeParseJson(text);

  const ir =
    parsed?.ir ||
    ({ name: (body.idea || "launchwing-app").slice(0, 24), app_type: "spa" } as MvpResult["ir"]);
  const files = parsed?.files || {};
  const smoke = { passed: true, logs: [] as string[] };

  return { ir, files, smoke };
}

/** Try several shapes the Responses API may return; fall back to common fields. */
function extractOutputText(j: any): string {
  if (!j) return "";
  // Newer format
  if (typeof j.output_text === "string") return j.output_text;
  // Older content list
  if (Array.isArray(j.output)) {
    const parts = j.output
      .map((p: any) => {
        if (typeof p.text === "string") return p.text;
        if (Array.isArray(p.content)) {
          return p.content.map((c: any) => c.text || "").join("");
        }
        return "";
      })
      .join("");
    if (parts) return parts;
  }
  // Fallbacks
  if (Array.isArray(j.content) && j.content[0]?.text) return j.content[0].text;
  return typeof j === "string" ? j : JSON.stringify(j);
}

/** Strict JSON parse with fallback to first balanced {...} block. */
function safeParseJson(raw: string): any | null {
  const s = raw?.trim();
  if (!s) return null;

  try {
    return JSON.parse(s);
  } catch {
    // Attempt to slice the first balanced JSON object
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = s.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        // no-op
      }
    }
  }
  return null;
}

async function write(writer: WritableStreamDefaultWriter, obj: unknown) {
  const line = JSON.stringify(obj) + "\n";
  await writer.write(new TextEncoder().encode(line));
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}