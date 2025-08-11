// src/api/mvp.ts
// Generate a per-idea plan (IR) + deployable file bundle via OpenAI Responses API.
// Adds structured logs so you can tail from CI or the CF dashboard.

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

const ORCH = "https://launchwing-orchestrator.promptpulse.workers.dev";

// Plain JS worker (Pages Direct Upload won’t transpile TS)
const INJECTED_WORKER_JS = `export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ORCH = "${ORCH}";

    const isApi =
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/") ||
      url.pathname === "/mvp" ||
      url.pathname === "/health" ||
      url.pathname === "/github-export" ||
      url.pathname === "/sandbox-deploy";

    if (isApi && req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
          "Vary": "Origin"
        }
      });
    }

    if (isApi) {
      const upstreamPath =
        url.pathname === "/api" ? "/" :
        url.pathname.startsWith("/api/") ? url.pathname.slice(4) :
        url.pathname;

      const upstream = new URL(upstreamPath + url.search, ORCH);
      const init = {
        method: req.method,
        headers: req.headers,
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
        redirect: "manual"
      };
      const r = await fetch(upstream.toString(), init);
      const h = new Headers(r.headers);
      h.set("x-lw-proxy", "app");
      h.set("Access-Control-Allow-Origin", "*");
      h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
      h.set("Vary", "Origin");
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }

    // Static + SPA fallback
    let res = await env.ASSETS.fetch(req);
    if (res.status === 404 && req.method === "GET" && !(url.pathname.startsWith("/_"))) {
      const indexReq = new Request(new URL("/index.html", url.origin), { headers: req.headers });
      res = await env.ASSETS.fetch(indexReq);
    }
    return res;
  }
};`;

export async function mvpHandler(req: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as MvpRequest;
    const idea = (body?.idea || "").trim();
    if (!idea) {
      console.log(JSON.stringify({ evt: "mvp.reject", reason: "missing_idea" }));
      return json({ ok: false, error: "Missing idea" }, 400);
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log(JSON.stringify({ evt: "mvp.reject", reason: "missing_openai_key" }));
      return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);
    }

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
      "You are an expert product+full‑stack generator for Cloudflare Pages (Advanced Mode) apps.",
      "Produce a minimal, production‑ready bundle that can be deployed via Cloudflare Pages Direct Upload.",
      "Constraints:",
      "- Avoid frameworks or build steps; output plain files (HTML, JS, CSS) and tiny server code only if necessary.",
      "- Use relative API paths (e.g., `/api/mvp`, `/api/health`).",
      "- If the app needs API, include routes handled via a Pages Advanced Mode Worker `_worker.js`, or assume a proxy will map `/api/*` to the orchestrator.",
      "- Keep total bundle size small; inline assets where reasonable; no external package managers.",
      "Quality bar:",
      "- Code should run without modification after upload.",
      "- Keep file paths stable and flat (e.g., `index.html`, `app.js`, `_worker.js`).",
      "- Comment sparingly but clearly."
    ].join("\n");

    const threadIntro = body?.ideaId ? `Idea ID: ${body.ideaId}\n` : "";
    const userPrompt =
      `${threadIntro}User idea:\n${idea}\n\n` +
      "Return JSON ONLY that matches the provided schema. Keep the file bundle minimal but functional.";

    const input: ChatMsg[] = [{ role: "system", content: sys }];

    if (Array.isArray(body?.thread) && body!.thread!.length) {
      for (const m of body!.thread!) {
        input.push({
          role: m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: String(m.content || "")
        });
      }
    }
    input.push({ role: "user", content: userPrompt });

    console.log(JSON.stringify({ evt: "mvp.openai.start", model, idea_len: idea.length }));

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
    console.log(JSON.stringify({ evt: "mvp.openai.done", status: r.status, ms: Date.now() - t0, bytes: rawText.length }));

    if (!r.ok) {
      return json({ ok: false, error: `OpenAI HTTP ${r.status} — ${rawText}` }, 502);
    }

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
      console.log(JSON.stringify({ evt: "mvp.parse.fail", reason: "not_json", ms: Date.now() - t0 }));
      return json({ ok: false, error: "Malformed JSON from OpenAI" }, 502);
    }

    const jsonPayload =
      parsedResp.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.value ??
      parsedResp.output_text ??
      "";

    if (!jsonPayload) {
      console.log(JSON.stringify({ evt: "mvp.parse.fail", reason: "empty_payload", ms: Date.now() - t0 }));
      return json({ ok: false, error: "Empty model output" }, 502);
    }

    let result: MvpResult;
    try {
      result = JSON.parse(jsonPayload) as MvpResult;
    } catch {
      const m = jsonPayload.match(/\{[\s\S]*\}$/);
      if (!m) {
        console.log(JSON.stringify({ evt: "mvp.parse.fail", reason: "json_extract_failed", ms: Date.now() - t0 }));
        return json({ ok: false, error: "Could not parse JSON from model output" }, 502);
      }
      result = JSON.parse(m[0]) as MvpResult;
    }

    // --- Guardrails on files (count/size) ---
    result.ir ||= { name: "Generated App", app_type: "spa_api" } as any;
    result.files ||= {};
    result.smoke ||= { passed: true, logs: [] };

    const MAX_FILES = 50;
    const MAX_BYTES = 300_000; // ~300 KB of UTF‑8 text
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

    // === Injection: ensure `_worker.js` exists for dynamic API proxy ===
    const hasWorker =
      Object.prototype.hasOwnProperty.call(outFiles, "_worker.js") ||
      Object.prototype.hasOwnProperty.call(outFiles, "_worker.ts");

    if (!hasWorker) {
      outFiles["_worker.js"] = INJECTED_WORKER_JS;
      result.smoke.logs.push("Injected _worker.js proxy → orchestrator");
      console.log(JSON.stringify({ evt: "mvp.inject.worker", file: "_worker.js" }));
    }

    result.files = outFiles;

    const ms = Date.now() - t0;
    console.log(JSON.stringify({ evt: "mvp.success", ms, files: Object.keys(outFiles).length, bytes: total }));
    return json({ ok: true, result, via: "openai-mvp-v1", via_detail: { ms } });
  } catch (err: any) {
    console.log(JSON.stringify({ evt: "mvp.error", err: String(err?.message || err) }));
    return json({ ok: false, error: String(err?.message || err || "unknown error") }, 500);
  }
}