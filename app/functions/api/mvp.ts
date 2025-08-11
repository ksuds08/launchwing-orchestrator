// src/api/mvp.ts
// Generates a per-idea plan (IR) + file bundle using OpenAI Responses API.

import { json } from "@utils/log";

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string; // e.g. "gpt-4.1-mini" (default below)
}

type MvpRequest = { idea?: string };
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

    // JSON schema for robust output
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
          description: "Map of file path → file contents (UTF-8 text). Include index.html and/or _worker.js as needed."
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

    const sys = [
      "You generate minimal, production-ready app bundles for Cloudflare Pages (Advanced Mode).",
      "Output a small set of files that can be deployed as-is via direct upload.",
      "Best practice:",
      "- If the app has frontend only, include index.html (can inline CSS/JS).",
      "- If the app needs API routes, add `_worker.js` that proxies `/api/*` to an orchestrator URL env var OR provides simple handlers.",
      "- Keep it tiny but functional. No external build steps.",
      "All files must be safe UTF-8 text."
    ].join("\n");

    const user = `Idea: ${idea}\n\nReturn JSON only that matches the provided schema.`;

    const openaiRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: sys },
          { role: "user", content: user }
        ],
        response_format: { type: "json_schema", json_schema: { name: "mvp_bundle", schema, strict: true } },
        temperature: 0.3,
        max_output_tokens: 3000
      })
    });

    const text = await openaiRes.text();
    if (!openaiRes.ok) {
      return json({ ok: false, error: `OpenAI HTTP ${openaiRes.status} — ${text}` }, 502);
    }

    // Parse OpenAI responses payload
    type OpenAIJson = {
      output?: Array<{ content?: Array<{ type: string; text?: { value?: string } }> }>;
    };
    let payload: OpenAIJson;
    try { payload = JSON.parse(text); } catch { return json({ ok: false, error: "Bad JSON from OpenAI" }, 502); }

    const raw = payload?.output?.[0]?.content?.[0]?.text?.value || "";
    if (!raw) return json({ ok: false, error: "Empty model output" }, 502);

    let parsed: MvpResult;
    try { parsed = JSON.parse(raw) as MvpResult; } catch {
      // Fallback: try to salvage JSON from text
      const match = raw.match(/\{[\s\S]*\}$/);
      if (!match) return json({ ok: false, error: "Could not parse JSON from model output" }, 502);
      parsed = JSON.parse(match[0]) as MvpResult;
    }

    // Safety net: ensure keys exist
    parsed.ir ||= { name: "Generated App", app_type: "spa_api" } as any;
    parsed.files ||= {};
    parsed.smoke ||= { passed: true, logs: [] };

    // Minimal guardrails: cap file count/size
    const MAX_FILES = 40;
    const MAX_BYTES = 200_000; // ~200 KB total text
    const enc = new TextEncoder();
    const entries = Object.entries(parsed.files).slice(0, MAX_FILES);
    let total = 0;
    const files: Record<string, string> = {};
    for (const [path, content] of entries) {
      const safePath = path.replace(/^\/+/, "");
      const bytes = enc.encode(content ?? "").length;
      total += bytes;
      if (total > MAX_BYTES) break;
      files[safePath] = String(content ?? "");
    }
    parsed.files = files;

    return json({ ok: true, result: parsed });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message || err || "unknown error") }, 500);
  }
}