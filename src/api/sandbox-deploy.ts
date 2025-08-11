// src/api/sandbox-deploy.ts
// Pages-first sandbox deploy with optional ephemeral cleanup.
// - mode="pages" (default): Direct Upload to Cloudflare Pages (Advanced Mode via _worker.js)
// - mode="workers": Publish Worker; if no public URL, auto-fallback to Pages
// - ephemeral=true → delete the created sandbox immediately after return (via ctx.waitUntil)
import { json } from "@utils/log";

export interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  ORCHESTRATOR_URL?: string;     // e.g. https://launchwing-orchestrator.promptpulse.workers.dev
  DEFAULT_DEPLOY_MODE?: string;   // "pages" | "workers"
}

type DeployRequest = {
  confirm?: boolean;
  mode?: "pages" | "workers";
  name?: string;
  ideaId?: string;
  ephemeral?: boolean;
};

type DeployResult = {
  ok: boolean;
  url?: string;
  name?: string;
  error?: string;
  fallback?: "pages" | "workers";
};

const CF_API = "https://api.cloudflare.com/client/v4";

/* -------------------------------- helpers -------------------------------- */

function bearer(env: Env) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Missing CLOUDFLARE_API_TOKEN");
  return { Authorization: `Bearer ${token}` };
}

function requireAccount(env: Env) {
  const id = env.CLOUDFLARE_ACCOUNT_ID;
  if (!id) throw new Error("Missing CLOUDFLARE_ACCOUNT_ID");
  return id;
}

async function cfJSON(env: Env, url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...bearer(env),
      ...(init?.headers || {}),
    },
  });
  const body = await r.text();
  let data: any = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* noop */ }
  if (!r.ok || (data && data.success === false)) {
    const msg = data?.errors?.[0]?.message || data?.message || `HTTP ${r.status}`;
    throw new Error(`${msg} — ${url}`);
  }
  return data?.result ?? data ?? {};
}

function pickName(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

/* --------------------------- deletion helpers ---------------------------- */

async function deletePagesProject(env: Env, name: string): Promise<void> {
  const account = requireAccount(env);
  await fetch(`${CF_API}/accounts/${account}/pages/projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { ...bearer(env) },
  });
}

async function deleteWorkerScript(env: Env, name: string): Promise<void> {
  const account = requireAccount(env);
  await fetch(`${CF_API}/accounts/${account}/workers/scripts/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { ...bearer(env) },
  });
}

/* ----------------------- Pages Direct Upload deploy ---------------------- */

async function deployPagesDirect(env: Env, name: string): Promise<{ url: string }> {
  const account = requireAccount(env);

  // 1) Create project if missing (idempotent)
  try {
    await cfJSON(env, `${CF_API}/accounts/${account}/pages/projects`, {
      method: "POST",
      body: JSON.stringify({
        name,
        production_branch: "main",
        build_config: { build_command: "", destination_dir: "/" }, // direct upload
      }),
    });
  } catch (e: any) {
    if (!/already exists|exists/i.test(String(e?.message || e))) throw e;
  }

  // 2) Minimal SPA + Advanced Mode worker that proxies /api/* to orchestrator
  const ORCH =
    env.ORCHESTRATOR_URL || "https://launchwing-orchestrator.promptpulse.workers.dev";

  const indexHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${name}</title>
  </head>
  <body style="font-family: system-ui; max-width: 780px; margin: 32px auto;">
    <h1>${name}</h1>
    <p>Sandbox app deployed via Pages Direct Upload.</p>
    <p>Try: <code>GET /api/health</code></p>
    <script>
      fetch('/api/health').then(r => r.text()).then(t => console.log('health:', t)).catch(console.error);
    </script>
  </body>
</html>`;

  const workerJs = `// Pages Advanced Mode proxy to orchestrator
const ORCH = ${JSON.stringify(ORCH)};
function corsHeaders(req) {
  const reqHdrs = req?.headers?.get("Access-Control-Request-Headers");
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": reqHdrs || "Content-Type, Authorization, X-Requested-With",
    "Vary": "Origin",
  };
}
const diag = (h) => { const H = new Headers(h || {}); H.set("x-lw-proxy", "pages"); return H; };
const preflight = (req) => new Response(null, { status: 204, headers: diag(corsHeaders(req)) });

function isApiLike(path) {
  const p = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  if (p === "/api" || p.startsWith("/api/")) return true;
  if (p === "/mvp" || p === "/health" || p === "/github-export" || p === "/sandbox-deploy") return true;
  if (p.includes("/api/")) return true;
  if (p.endsWith("/mvp") || p.endsWith("/health") || p.endsWith("/github-export") || p.endsWith("/sandbox-deploy")) return true;
  return false;
}
function upstreamPath(path) {
  const idxApi = path.indexOf("/api/");
  if (path === "/api" || path === "/api/") return "/";
  if (idxApi >= 0) return path.slice(idxApi + 4);
  const known = ["/mvp", "/health", "/github-export", "/sandbox-deploy"];
  for (const k of known) {
    const i = path.lastIndexOf(k);
    if (i >= 0) return path.slice(i);
  }
  return "/";
}
async function serveSPA(req, env) {
  const exact = await env.ASSETS.fetch(req);
  if (exact.status !== 404) return exact;
  const accepts = req.headers.get("accept") || "";
  const isGetLike = req.method === "GET" || req.method === "HEAD";
  if (isGetLike && accepts.includes("text/html")) {
    const url = new URL(req.url);
    const indexReq = new Request(new URL("/index.html", url), req);
    const indexRes = await env.ASSETS.fetch(indexReq);
    if (indexRes.status !== 404) return indexRes;
  }
  return exact;
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (isApiLike(url.pathname)) {
      if (req.method === "OPTIONS") return preflight(req);
      const upstream = new URL(upstreamPath(url.pathname), ORCH);
      upstream.search = url.search;
      const init = {
        method: req.method,
        headers: req.headers,
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
        redirect: "manual",
      };
      const r = await fetch(upstream.toString(), init);
      const h = diag(r.headers);
      const c = corsHeaders(req);
      for (const k in c) h.set(k, c[k]);
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }
    return serveSPA(req, env);
  },
};`;

  const files: Record<string, string> = {
    "index.html": indexHtml,
    "_worker.js": workerJs,
  };

  // 3) Direct Upload via FormData
  //    IMPORTANT: "manifest" must be a simple string field; assets are Files.
  const enc = new TextEncoder();
  const manifest = {
    files: Object.fromEntries(
      Object.entries(files).map(([p, c]) => [p, { size: enc.encode(c).length }])
    ),
  };

  const fd = new FormData();
  fd.append("manifest", JSON.stringify(manifest)); // <-- string field (fixes 8000096)

  for (const [path, content] of Object.entries(files)) {
    const type = path.endsWith(".js") ? "application/javascript" : "text/html";
    fd.append(path, new File([content], path, { type }));
  }

  const dep = await fetch(
    `${CF_API}/accounts/${account}/pages/projects/${encodeURIComponent(name)}/deployments`,
    {
      method: "POST",
      headers: { ...bearer(env) }, // do NOT set content-type; Workers adds boundary
      body: fd,
    }
  );

  const depText = await dep.text();
  if (!dep.ok) throw new Error(`Pages deploy failed: HTTP ${dep.status} — ${depText}`);

  let depJson: any = {};
  try { depJson = depText ? JSON.parse(depText) : {}; } catch { /* noop */ }

  const result = depJson?.result || depJson;
  const primary = result?.url || result?.domains?.[0];
  const url = primary
    ? (/^https?:\/\//i.test(primary) ? primary : `https://${primary}`)
    : `https://${name}.pages.dev`;

  return { url };
}

/* --------------------------- Worker deploy (opt) ------------------------- */

async function deployWorker(env: Env, name: string): Promise<{ url?: string }> {
  const account = requireAccount(env);
  const code = `export default { fetch() { return new Response("OK: ${name}", {status: 200}); } };`;

  const r = await fetch(
    `${CF_API}/accounts/${account}/workers/scripts/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/javascript", ...bearer(env) },
      body: code,
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Worker upload failed: HTTP ${r.status} — ${t}`);
  }
  // No URL guaranteed without routes/workers.dev
  return { url: undefined };
}

/* -------------------------------- handler -------------------------------- */

export async function sandboxDeployHandler(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const payload = (await req.json().catch(() => ({}))) as DeployRequest;
    if (!payload?.confirm) return json({ ok: false, error: "confirm=false" }, 400);

    const desired = (payload.mode || env.DEFAULT_DEPLOY_MODE || "pages") as "pages" | "workers";
    const name = (payload.name || pickName("lw-sbx"))
      .toLowerCase()
      .replace(/[^a-z0-9\-]/g, "-");
    const ephemeral = Boolean(payload.ephemeral);

    if (desired === "workers") {
      try {
        const w = await deployWorker(env, name);
        if (!w.url) {
          const p = await deployPagesDirect(env, name);
          if (ephemeral) ctx.waitUntil(deletePagesProject(env, name));
          return json({ ok: true, name, url: p.url, fallback: "pages" });
        }
        if (ephemeral) ctx.waitUntil(deleteWorkerScript(env, name));
        return json({ ok: true, name, url: w.url });
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/workers\.dev.*disabled|workers_dev/i.test(msg)) {
          const p = await deployPagesDirect(env, name);
          if (ephemeral) ctx.waitUntil(deletePagesProject(env, name));
          return json({ ok: true, name, url: p.url, fallback: "pages" });
        }
        throw e;
      }
    }

    // Default: Pages
    const p = await deployPagesDirect(env, name);
    if (ephemeral) ctx.waitUntil(deletePagesProject(env, name));
    return json({ ok: true, name, url: p.url });
  } catch (err: any) {
    return json({ ok: false, error: String(err?.message || err || "unknown error") }, 500);
  }
}