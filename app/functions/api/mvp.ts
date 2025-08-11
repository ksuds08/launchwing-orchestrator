// app/functions/api/mvp.ts
// Normalize OpenAI output to a deployable (buildless) Pages bundle.
// Returns { ok, result: { ir, files, smoke }, via, model, oai_request_id, took_ms }

export const onRequestPost: PagesFunction<{
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  OPENAI_PROJECT?: string;
  ASSETS: Fetcher;
}> = async (ctx) => {
  const { request, env } = ctx;

  const json = (obj: any, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    });

  type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
  type MvpRequest = { idea?: string; ideaId?: string; thread?: ChatMsg[] };
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
    artifacts?: Record<string, string>;
    smoke: { passed: boolean; logs: string[] };
  };

  const ORCH = "https://launchwing-orchestrator.promptpulse.workers.dev";

  // Buildless worker in plain JS for Pages Direct Upload (proxy API to orchestrator)
  const PROXY_WORKER_JS = `export default {
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
        const path =
          url.pathname === "/api" ? "/" :
          url.pathname.startsWith("/api/") ? url.pathname.slice(4) :
          url.pathname;

        const upstream = new URL(path + url.search, ORCH);
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

  function synthIndexHTML(ir: IR) {
    const title = escapeHtml(ir?.name || "LaunchWing App");
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; line-height: 1.4; }
      input, button, textarea { font: inherit; padding: .5rem .6rem; }
      .row { display: flex; gap: .5rem; align-items: center; }
      .log { margin-top: 1rem; white-space: pre-wrap; background: #f6f6f9; padding: .75rem; border-radius: .5rem; }
      a { color: inherit; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>This sandbox hits <code>/api/health</code> and <code>/api/echo</code> via the app's <code>_worker.js</code> proxy.</p>

    <div class="row">
      <input id="msg" placeholder="Type a message..." value="hello" />
      <button id="btnEcho">Echo</button>
      <button id="btnHealth">Health</button>
    </div>

    <div class="log" id="log">Ready.</div>

    <script>
      const log = (t) => { document.getElementById('log').textContent = t; };
      document.getElementById('btnEcho').onclick = async () => {
        try {
          log('POST /api/echo ...');
          const msg = document.getElementById('msg').value || 'hello';
          const r = await fetch('/api/echo', {
            method: 'POST',
            headers: {'content-type':'application/json'},
            body: JSON.stringify({ message: msg })
          });
          log('Echo → ' + (await r.text()));
        } catch (e) { log('Echo error: ' + e); }
      };
      document.getElementById('btnHealth').onclick = async () => {
        try {
          log('GET /api/health ...');
          const r = await fetch('/api/health');
          log('Health → ' + (await r.text()));
        } catch (e) { log('Health error: ' + e); }
      };
    </script>
  </body>
</html>`;
  }

  function escapeHtml(s: string) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  try {
    const body = (await request.json().catch(() => ({}))) as MvpRequest;
    const idea = (body?.idea || "").trim();
    if (!idea) return json({ ok: false, error: "Missing idea" }, 400);

    if (!env.OPENAI_API_KEY) return json({ ok: false, error: "Missing OPENAI_API_KEY" }, 500);
    const model = env.OPENAI_MODEL || "gpt-4.1-mini";

    // Schema the model must return
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        ir: { type: "object", additionalProperties: true },
        files: { type: "object", additionalProperties: { type: "string" } },
        artifacts: { type: "object", additionalProperties: { type: "string" } },
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
      required: ["ir", "smoke"],
    };

    // Compose input (system + thread + user)
    const sys = [
      "You are an expert product+full‑stack generator for Cloudflare Pages (Advanced Mode) apps.",
      "Prefer buildless output: plain files (HTML, JS, CSS). Avoid frameworks/build steps.",
      "If you emit TypeScript/TSX or complex folders, also include a minimal buildless variant in `files`.",
      "Use relative API paths (`/api/*`).",
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
    input.push({ role: "user", content: `Idea:\n${idea}\n\nReturn JSON ONLY matching the schema.` });

    // --- OpenAI Responses API call with timing + project header ---
    const started = Date.now();
    const headers: Record<string, string> = {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    };
    if (env.OPENAI_PROJECT) headers["OpenAI-Project"] = env.OPENAI_PROJECT;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input,
        response_format: { type: "json_schema", json_schema: { name: "mvp_bundle", schema, strict: true } },
        temperature: 0.3,
        max_output_tokens: 3500,
      }),
    });
    const took_ms = Date.now() - started;
    const oai_request_id = r.headers.get("x-request-id");

    const raw = await r.text();
    if (!r.ok) return json({ ok: false, error: `OpenAI HTTP ${r.status} — ${raw}` }, 502);

    type Resp = {
      output_text?: string;
      output?: Array<{ content?: Array<{ type: string; text?: { value?: string } }> }>;
    };
    let parsed: Resp;
    try {
      parsed = JSON.parse(raw) as Resp;
    } catch {
      return json({ ok: false, error: "Malformed JSON from OpenAI" }, 502);
    }

    const payload =
      parsed.output?.[0]?.content?.find((c) => c.type === "output_text")?.text?.value ??
      parsed.output_text ??
      "";

    if (!payload) return json({ ok: false, error: "Empty model output" }, 502);

    let result: MvpResult;
    try {
      result = JSON.parse(payload) as any;
    } catch {
      const m = payload.match(/\{[\s\S]*\}$/);
      if (!m) return json({ ok: false, error: "Could not parse JSON from model output" }, 502);
      result = JSON.parse(m[0]) as any;
    }

    // Guardrails + normalization
    result.ir ||= { name: "Generated App", app_type: "spa_api" } as any;
    result.files ||= {};
    result.artifacts ||= {};
    result.smoke ||= { passed: true, logs: [] };

    // If only artifacts (TS/TSX etc.), synthesize buildless files
    const needsSynthesis = Object.keys(result.files).length === 0 && Object.keys(result.artifacts).length > 0;
    if (needsSynthesis) {
      result.files["index.html"] = synthIndexHTML(result.ir);
      result.smoke.logs.push("Synthesized buildless index.html from IR because only artifacts were provided.");
    }

    // Enforce limits + sanitize paths
    const MAX_FILES = 50;
    const MAX_BYTES = 300_000;
    const enc = new TextEncoder();
    const outFiles: Record<string, string> = {};
    let total = 0;
    let n = 0;

    for (const [p0, c0] of Object.entries(result.files)) {
      if (n >= MAX_FILES) break;
      const p = String(p0 || "").replace(/^\/+/, "");
      const c = String(c0 ?? "");
      const sz = enc.encode(c).length;
      if (total + sz > MAX_BYTES) break;
      outFiles[p] = c;
      total += sz;
      n++;
    }

    // Ensure `_worker.js` exists for dynamic API
    if (!("_worker.js" in outFiles) && !("_worker.ts" in outFiles)) {
      outFiles["_worker.js"] = PROXY_WORKER_JS;
      result.smoke.logs.push("Injected _worker.js proxy → orchestrator.");
    }

    result.files = outFiles;

    return json({
      ok: true,
      result,
      via: "openai-mvp-v1",
      model,
      oai_request_id,
      took_ms,
    });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
};