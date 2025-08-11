// src/api/mvp.ts
// Require the model to return a buildless `files` bundle (HTML/JS/CSS/_worker.js).
// If it doesn't, we 502 with a clear error so the UI won't silently show nothing.
// Returns proof fields: via, model, oai_request_id, took_ms.
// NEW: if the request has ?debug=1, include debug_raw_openai + debug_payload in the response.

import { json } from "@utils/log";

export interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string; // optional override
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type MvpRequest = {
  idea?: string;
  ideaId?: string;
  thread?: ChatMsg[];
};

type IR = {
  name: string;
  app_type: "spa_api" | "spa" | "api";
  pages?: string[];
  api_routes?: Array<{ method: string; path: string }>;
  notes?: string;
  features?: string[];
};

type MvpResult = {
  ir: IR;
  files: Record<string, string>;
  smoke: { passed: boolean; logs: string[] };
};

export async function mvpHandler(req: Request, env: Env): Promise<Response> {
  const t0 = Date.now();
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    const body = (await req.json().catch(() => ({}))) as MvpRequest;
    const idea = (body?.idea || "").trim();
    if (!idea) return json({ ok: false, error: "Missing idea" }, 400);

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);

    const model = env.OPENAI_MODEL || "gpt-4.1-mini";

    // strict schema: must produce buildless `files`
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
                properties: { method: { type: "string" }, path: { type: "string" } },
                required: ["method", "path"],
              },
            },
            notes: { type: "string" },
            features: { type: "array", items: { type: "string" } },
          },
          required: ["name", "app_type"],
        },
        files: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            "Plain HTML/JS/CSS and optional `_worker.js`. No TS/TSX, no package.json, no build configs.",
        },
        smoke: {
          type: "object",
          additionalProperties: false,
          properties: {
            passed: { type: "boolean" },
            logs: { type: "array", items: { type: "string" } },
          },
          required: ["passed", "logs"],
        },
      },
      required: ["ir", "files", "smoke"],
    };

    const sys = [
      "You are an expert generator for Cloudflare Pages (Advanced Mode).",
      "Return a SMALL, DEPLOYABLE bundle in `files` ONLY (no `artifacts`).",
      "Rules:",
      "- Buildless only: plain HTML/JS/CSS and optional `_worker.js`.",
      "- NO TypeScript/TSX, NO package.json, NO build steps.",
      "- Use relative API paths like `/api/echo`.",
      "- `index.html` must mention the user's idea explicitly.",
      "Quality:",
      "- Must run after direct upload to Pages with no changes.",
      "- Keep filenames flat (index.html, app.js, _worker.js).",
    ].join("\n");

    const input: ChatMsg[] = [{ role: "system", content: sys }];

    if (Array.isArray(body?.thread) && body.thread.length) {
      for (const m of body.thread) {
        input.push({
          role: m.role === "assistant" || m.role === "system" ? m.role : "user",
          content: String(m.content || ""),
        });
      }
    }

    const threadIntro = body?.ideaId ? `Idea ID: ${body.ideaId}\n` : "";
    input.push({
      role: "user",
      content:
        `${threadIntro}User idea:\n${idea}\n\n` +
        "Return JSON ONLY matching the schema. Include `index.html` and `app.js` in `files`.",
    });

    // call OpenAI Responses API
    const started = Date.now();
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        response_format: { type: "json_schema", json_schema: { name: "mvp_bundle", schema, strict: true } },
        temperature: 0.35,
        max_output_tokens: 3500,
      }),
    });

    const oai_request_id = r.headers.get("x-request-id") || null;
    const took_ms = Date.now() - started;
    const raw = await r.text();

    if (!r.ok) return json({ ok: false, error: `OpenAI HTTP ${r.status} — ${raw}`, oai_request_id }, 502);

    type Resp = {
      output_text?: string;
      output?: Array<{ content?: Array<{ type: string; text?: { value?: string } }> }>;
    };
    let parsed: Resp;
    try {
      parsed = JSON.parse(raw) as Resp;
    } catch {
      return json({ ok: false, error: "Malformed JSON from OpenAI", oai_request_id }, 502);
    }

    const payload =
      parsed.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.value ??
      parsed.output_text ??
      "";

    if (!payload) return json({ ok: false, error: "Empty model output", oai_request_id }, 502);

    let result: MvpResult;
    try {
      result = JSON.parse(payload) as MvpResult;
    } catch {
      const m = payload.match(/\{[\s\S]*\}$/);
      if (!m) return json({ ok: false, error: "Could not parse JSON from model output", oai_request_id }, 502);
      result = JSON.parse(m[0]) as MvpResult;
    }

    // REQUIRE a non-empty files bundle
    if (!result.files || typeof result.files !== "object" || !Object.keys(result.files).length) {
      return json(
        {
          ok: false,
          error:
            "Model did not return a buildless `files` bundle. Try again; we forbid TS/TSX and build configs to ensure deployable output.",
          oai_request_id,
        },
        502
      );
    }

    // sanitize + limit
    result.ir ||= { name: "Generated App", app_type: "spa_api" } as IR;
    result.smoke ||= { passed: true, logs: [] };

    const MAX_FILES = 50;
    const MAX_BYTES = 300_000;
    const enc = new TextEncoder();
    const out: Record<string, string> = {};
    let total = 0;
    let n = 0;

    for (const [p0, c0] of Object.entries(result.files)) {
      if (n >= MAX_FILES) break;
      const p = String(p0 || "").replace(/^\/+/, "");
      const c = String(c0 ?? "");
      const sz = enc.encode(c).length;
      if (total + sz > MAX_BYTES) break;
      out[p] = c;
      total += sz;
      n++;
    }

    // Ensure a minimal worker if API is implied
    const needsApi =
      (result.ir.api_routes && result.ir.api_routes.length > 0) ||
      Object.keys(out).some((k) => k.toLowerCase() === "_worker.js");
    if (needsApi && !("_worker.js" in out)) {
      out["_worker.js"] = `export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (isApi && req.method === "OPTIONS") {
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type, Authorization, X-Requested-With",
        "Vary":"Origin"}});}
    return env.ASSETS.fetch(req);
  }
};`;
      result.smoke.logs.push("Injected minimal _worker.js to enable /api/*.");
    }

    result.files = out;

    return json({
      ok: true,
      result,
      via: "openai-mvp-v1",
      model,
      oai_request_id,
      took_ms,
      ...(debug ? { debug_raw_openai: raw, debug_payload: payload } : {}),
    });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}