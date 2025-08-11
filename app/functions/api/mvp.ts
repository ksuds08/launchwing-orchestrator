// src/api/mvp.ts
// Generate a per-idea plan (IR) + deployable file bundle via OpenAI Responses API.

import { json } from "@utils/log";

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string; // optional override, default below
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type MvpRequest = {
  idea?: string;
  ideaId?: string;
  thread?: ChatMsg[]; // optional compact chat history from the UI
};

type MvpResult = {
  ir: {
    name: string;
    app_type: "spa_api" | "spa" | "api";
    pages?: string[];
    api_routes?: Array<{ method: string; path: string }>;
    notes?: string;
  };
  files: Record<string, string>;
  smoke: { passed: boolean; logs: string[] };
};

export async function mvpHandler(req: Request, env: Env): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as MvpRequest;
    const idea = (body?.idea || "").trim();
    if (!idea) return json({ ok: false, error: "Missing idea" }, 400);

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);

    const model = env.OPENAI_MODEL || "gpt-4.1-mini";

    // --- Output schema the model must follow ---
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        ir: {
          type: "object",
          additionalProperties: true,
          properties: {
            name: { type: "string" },
            app_type: { type: "string", enum: ["spa_api", "spa", "api"] },
            pages: { type: "array", items: { type: "string" } },
            api_routes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  method: { type: "string" },
                  path: { type: "string" }
                },
                required: ["method", "path"]
              }
            },
            notes: { type: "string" }
          },
          required: ["name", "app_type"]
        },
        files: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Map of file path → UTF-8 contents. Keep the bundle tiny and deployable on Cloudflare Pages Direct Upload (Advanced Mode). Prefer vanilla HTML/JS, inline assets, and zero build steps."
        },
        smoke: {
          type: "object",
          additionalProperties: false,
          properties: {
            passed: { type: "boolean" },
            logs: { type: "array", items: { type: "string" } }
          },
          required: ["passed", "logs"]
        }
      },
      required: ["ir", "files", "smoke"]
    };

    // --- System / developer guidance for the model ---
    const sys = [
      "You are an expert product+full-stack generator for Cloudflare Pages (Advanced Mode) apps.",
      "Produce a minimal, production-ready bundle that can be deployed via Cloudflare Pages Direct Upload.",
      "Constraints:",
      "- Avoid frameworks or build steps; output plain files (HTML, JS, CSS) and tiny server code only if necessary.",
      "- If the app needs API, include routes handled via a Pages Advanced Mode Worker `_worker.js` or proxy `/api/*` to an orchestrator URL placeholder.",
      "- Keep total bundle size small; inline assets where reasonable; no external package managers.",
      "Quality bar:",
      "- Code should run without modification after upload.",
      "- Keep file paths stable and flat (e.g., `index.html`, `app.js`, `_worker.js`).",
      "- Comment sparingly but clearly."
    ].join("\n");

    // Thread comes from the UI; include ideaId as light context if present
    const threadIntro =
      body?.ideaId ? `Idea ID: ${body.ideaId}\n` : "";
    const userPrompt =
      `${threadIntro}User idea:\n${idea}\n\n` +
      "Return JSON ONLY that matches the provided schema. Keep the file bundle minimal but functional.";

    const input: ChatMsg[] = [{ role: "system", content: sys }];

    if (Array.isArray(body?.thread) && body!.thread!.length) {
      // Append recent thread for context (already trimmed by frontend)
      for (const m of body!.thread!) {
        input.push({
          role: m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: String(m.content || "")
        });
      }
    }
    input.push({ role: "user", content: userPrompt });

    // --- Call OpenAI Responses API ---
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input,
        response_format: {
          type: "json_schema",
          json_schema: { name: "mvp_bundle", schema, strict: true }
        },
        temperature: 0.3,
        max_output_tokens: 3500
      })
    });

    const rawText = await r.text();
    if (!r.ok) {
      // Bubble exact error for easier debugging in UI/CI
      return json({ ok: false, error: `OpenAI HTTP ${r.status} — ${rawText}` }, 502);
    }

    // Responses API structure: parse robustly
    type Resp = {
      output_text?: string;
      output?: Array<{
        content?: Array<{ type: string; text?: { value?: string } }>;
      }>;
    };

    let parsedResp: Resp;
    try {
      parsedResp = JSON.parse(rawText) as Resp;
    } catch {
      return json({ ok: false, error: "Malformed JSON from OpenAI" }, 502);
    }

    const jsonPayload =
      parsedResp.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.value ??
      parsedResp.output_text ??
      "";

    if (!jsonPayload) {
      return json({ ok: false, error: "Empty model output" }, 502);
    }

    let result: MvpResult;
    try {
      result = JSON.parse(jsonPayload) as MvpResult;
    } catch {
      // Attempt to salvage JSON block
      const m = jsonPayload.match(/\{[\s\S]*\}$/);
      if (!m) return json({ ok: false, error: "Could not parse JSON from model output" }, 502);
      result = JSON.parse(m[0]) as MvpResult;
    }

    // --- Guardrails on files (count/size) ---
    result.ir ||= { name: "Generated App", app_type: "spa_api" } as any;
    result.files ||= {};
    result.smoke ||= { passed: true, logs: [] };

    const MAX_FILES = 50;
    const MAX_BYTES = 300_000; // ~300 KB of UTF-8 text
    const enc = new TextEncoder();
    const outFiles: Record<string, string> = {};
    let total = 0;
    let n = 0;

    for (const [path0, content0] of Object.entries(result.files)) {
      if (n >= MAX_FILES) break;
      const path = String(path0 || "").replace(/^\/+/, "");
      const content = String(content0 ?? "");
      const sz = enc.encode(content).length;
      if (total + sz > MAX_BYTES) break;
      outFiles[path] = content;
      total += sz;
      n++;
    }

    result.files = outFiles;

    // *** Updated return with version tag ***
    return json({ ok: true, result, via: "openai-mvp-v1" });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message || err || "unknown error") }, 500);
  }
}