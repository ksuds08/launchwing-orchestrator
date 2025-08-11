// src/index.ts
import { mvpHandler } from "@api/mvp";
import { sandboxDeployHandler } from "@api/sandbox-deploy";
import { githubExportHandler } from "@api/github-export";
import { json } from "@utils/log";

export interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKERS_SUBDOMAIN?: string;
  // If set, we’ll use this exact origin; otherwise default to "*"
  ALLOW_ORIGIN?: string;
  ASSETS: Fetcher;
}

type H = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

/* -------------------- Path helpers -------------------- */
// Normalize:
//  - strip trailing "/" (except root)
//  - allow either "/x" or "/api/x" (Pages proxy differences)
//  - keep a canonical "/x" for routing
function normalizePath(pathname: string): string {
  let p = pathname;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p === "/api") return "/"; // treat "/api" as root for health, etc.
  if (p.startsWith("/api/")) p = p.slice(4); // drop "/api"
  return p;
}

/* -------------------- CORS helpers -------------------- */
function corsHeaders(env: Env, req?: Request): Record<string, string> {
  const origin = env.ALLOW_ORIGIN ?? "*";
  // Reflect requested headers if present (helps avoid strict preflights)
  const acrh = req?.headers.get("Access-Control-Request-Headers") || "Content-Type, Authorization, X-Requested-With";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": acrh,
    "Vary": "Origin",
    "x-lw-orch": "true", // diagnostic
  };
}

function withCors(env: Env, res: Response | string, init?: ResponseInit, req?: Request): Response {
  const base = typeof res === "string" ? new Response(res, init) : res;
  const headers = new Headers(base.headers);
  const c = corsHeaders(env, req);
  Object.entries(c).forEach(([k, v]) => headers.set(k, v));
  return new Response(base.body, { status: base.status, statusText: base.statusText, headers });
}

function preflight(env: Env, req: Request): Response {
  return withCors(env, new Response(null, { status: 204 }), undefined, req);
}

/* -------------------- Routes -------------------- */
const routes: Record<
  string,
  {
    // map METHOD -> handler
    methods: Partial<Record<string, H>>;
    // list of allowed methods (for 405 "Allow" header)
    allow: string[];
  }
> = {
  "/": {
    methods: { GET: async () => json({ ok: true }) }, // health at root
    allow: ["GET", "OPTIONS"],
  },
  "/health": {
    methods: { GET: async () => json({ ok: true }), POST: async () => json({ ok: true }) },
    allow: ["GET", "POST", "OPTIONS"],
  },
  "/mvp": {
    methods: { POST: mvpHandler },
    allow: ["POST", "OPTIONS"],
  },
  "/sandbox-deploy": {
    methods: { POST: sandboxDeployHandler },
    allow: ["POST", "OPTIONS"],
  },
  "/github-export": {
    methods: { POST: githubExportHandler },
    allow: ["POST", "OPTIONS"],
  },
};

/* -------------------- Static assets / SPA fallback -------------------- */
async function serveAssets(req: Request, env: Env): Promise<Response> {
  // 1) Try to serve the exact asset
  const assetRes = await env.ASSETS.fetch(req);
  if (assetRes.status !== 404) return assetRes;

  // 2) SPA fallback to /index.html for GET/HEAD + HTML
  const url = new URL(req.url);
  const acceptsHTML = (req.headers.get("accept") || "").includes("text/html");
  const isGetLike = req.method === "GET" || req.method === "HEAD";
  if (isGetLike && acceptsHTML) {
    const indexReq = new Request(new URL("/index.html", url), req);
    const indexRes = await env.ASSETS.fetch(indexReq);
    if (indexRes.status !== 404) return indexRes;
  }
  return new Response("Not found", { status: 404 });
}

/* -------------------- Worker entry -------------------- */
export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const path = normalizePath(url.pathname);

    // --- GLOBAL CORS PREFLIGHT (never 405 on OPTIONS anywhere) --------------
    if (method === "OPTIONS") {
      // If it's an API-ish path (/, /mvp, /api/mvp, etc.), return 204 now.
      // Otherwise, still return 204 so frontends don't choke on assets routes.
      return preflight(env, req);
    }
    // -----------------------------------------------------------------------

    // API routing
    const route = routes[path];
    if (route) {
      const handler = route.methods[method];
      if (handler) {
        const res = await handler(req, env, ctx);
        return withCors(env, res, undefined, req);
      }
      // Known path but wrong method -> 405 with Allow + CORS
      return withCors(
        env,
        new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: route.allow.join(", ") },
        }),
        undefined,
        req
      );
    }

    // Otherwise try SPA/assets (no CORS needed for static, but harmless)
    const res = await serveAssets(req, env);
    // Add CORS so callers from Pages still see permissive headers
    return withCors(env, res, undefined, req);
  },
} satisfies ExportedHandler<Env>;