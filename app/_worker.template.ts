// app/_worker.template.ts
// Pages Advanced Mode worker that:
// - Proxies /api/* to orchestrator
// - ALSO proxies top-level API paths (/mvp, /health, /github-export, /sandbox-deploy)
// - Handles OPTIONS with 204 + CORS
// - Adds x-lw-proxy: pages for debugging

const ORCH = "https://launchwing-orchestrator.promptpulse.workers.dev";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Vary": "Origin",
  };
}
const diag = (h: Headers = new Headers()) => { h.set("x-lw-proxy", "pages"); return h; };
const preflight = () => new Response(null, { status: 204, headers: diag(new Headers(corsHeaders())) });

function isApiLike(path: string): boolean {
  if (path === "/api" || path.startsWith("/api/")) return true;
  // top-level API endpoints we want to support without /api prefix
  return path === "/mvp" || path === "/health" || path === "/github-export" || path === "/sandbox-deploy";
}

// normalize to upstream path (strip /api prefix if present)
function upstreamPath(path: string): string {
  if (path === "/api") return "/";
  if (path.startsWith("/api/")) return path.slice(4); // remove "/api"
  return path; // already top-level endpoint like "/mvp"
}

async function serveSPA(req: Request, env: { ASSETS: Fetcher }): Promise<Response> {
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
  return exact; // 404
}

export default {
  async fetch(req: Request, env: { ASSETS: Fetcher }) {
    const url = new URL(req.url);

    if (isApiLike(url.pathname)) {
      if (req.method === "OPTIONS") return preflight();

      const upstream = new URL(upstreamPath(url.pathname), ORCH);
      upstream.search = url.search;

      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : req.body,
        redirect: "manual",
      };

      const r = await fetch(upstream.toString(), init);
      const h = diag(new Headers(r.headers));
      const c = corsHeaders();
      for (const [k, v] of Object.entries(c)) h.set(k, v);
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }

    // Not API → static/SPA
    return serveSPA(req, env);
  },
} satisfies ExportedHandler;