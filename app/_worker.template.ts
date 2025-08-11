// app/_worker.template.ts
// Cloudflare Pages Advanced Mode worker: proxies /api/* to the orchestrator,
// handles OPTIONS preflight with CORS, catches non-root API paths,
// and adds a debug header: x-lw-proxy: pages

export interface Env {
  ASSETS: Fetcher;            // Auto-bound by Cloudflare Pages
  // Optional override via Pages env var if you don't want to hardcode:
  ORCHESTRATOR_URL?: string;  // e.g. https://launchwing-orchestrator.promptpulse.workers.dev
}

const DEFAULT_ORCH = "https://launchwing-orchestrator.promptpulse.workers.dev";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Vary": "Origin",
  };
}

function addDiag(h: Headers = new Headers()): Headers {
  h.set("x-lw-proxy", "pages");
  return h;
}

function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: addDiag(new Headers(corsHeaders())) });
}

// Treat anything containing "/api/" as API, even if not root-based (e.g. /x/y/api/z)
function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname.includes("/api/");
}

// Normalize to a root-based /api path for upstream (e.g. /x/api/y -> /api/y)
function normalizeApiPath(pathname: string): string {
  const idx = pathname.indexOf("/api/");
  if (pathname === "/api") return "/api";
  return idx >= 0 ? pathname.slice(idx) : pathname;
}

async function serveSPA(req: Request, env: Env): Promise<Response> {
  // Try the exact asset first
  const res = await env.ASSETS.fetch(req);
  if (res.status !== 404) return res;

  // SPA fallback to /index.html for GET/HEAD + HTML Accept
  const accepts = req.headers.get("accept") || "";
  const isGetLike = req.method === "GET" || req.method === "HEAD";
  if (isGetLike && accepts.includes("text/html")) {
    const url = new URL(req.url);
    const indexReq = new Request(new URL("/index.html", url), req);
    const indexRes = await env.ASSETS.fetch(indexReq);
    if (indexRes.status !== 404) return indexRes;
  }

  return res;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (isApiPath(url.pathname)) {
      if (req.method === "OPTIONS") return corsPreflight();

      const apiPath = normalizeApiPath(url.pathname);          // e.g. "/api/mvp"
      const upstreamBase = env.ORCHESTRATOR_URL || DEFAULT_ORCH;
      const upstreamUrl = new URL(upstreamBase);
      upstreamUrl.pathname = apiPath.replace(/^\/api/, "");     // strip "/api" for upstream
      upstreamUrl.search = url.search;

      // Preserve method/headers/body (no body for GET/HEAD)
      const init: RequestInit = {
        method: req.method,
        headers: req.headers,
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : (req as any).body,
        redirect: "manual",
      };

      const upstreamResp = await fetch(upstreamUrl.toString(), init);

      // Add permissive CORS + diagnostic header
      const h = addDiag(new Headers(upstreamResp.headers));
      for (const [k, v] of Object.entries(corsHeaders())) h.set(k, v);

      return new Response(upstreamResp.body, {
        status: upstreamResp.status,
        statusText: upstreamResp.statusText,
        headers: h,
      });
    }

    // Static assets / SPA fallback
    return serveSPA(req, env);
  },
} satisfies ExportedHandler<Env>;