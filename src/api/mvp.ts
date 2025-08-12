import type { Env, MvpRequest, MvpResult } from "../types";
import { json as log } from "../utils/log";
import { sanitizeGeneratedFiles } from "../utils/sanitizeGeneratedFiles";
import { ensureRepo, pushFilesWithContentsAPI } from "../utils/github";

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

        const agent = await callAgent(env, input, (msg) => write(writer, { step: "agent", message: msg }));

        await write(writer, { step: "sanitize", message: "Sanitizing files…" });
        const appName = (agent.ir?.name || `app-${tag}`).replace(/[^\w-]/g, "-").toLowerCase();
        const files = sanitizeGeneratedFiles(env, agent.files || {}, appName);

        const repoName = appName;
        await write(writer, { step: "repo", message: `Ensuring repo ${repoName}…` });
        await ensureRepo(env, repoName, true);

        await write(writer, { step: "push", message: `Pushing ${Object.keys(files).length} files…` });
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
  const agent = await callAgent(env, input);
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

async function callAgent(
  env: Env,
  body: MvpRequest,
  onTick?: (msg: string) => void
): Promise<MvpResult> {
  const AGENT = env.AGENT_URL || "https://launchwing-agent.onrender.com";
  const url = `${AGENT.replace(/\/$/, "")}/generate-batch`;

  onTick?.("Contacting generation agent…");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent ${res.status}: ${text.slice(0, 200)}`);
  }
  onTick?.("Agent responded.");

  const data = (await res.json()) as MvpResult | any;
  // Coerce shape defensively
  const ir = data.ir || data.plan || { name: body.idea?.slice(0, 24) || "launchwing-app", app_type: "spa" };
  const files = data.files || data.output?.files || {};
  const smoke = data.smoke || { passed: true, logs: [] };

  return { ir, files, smoke };
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