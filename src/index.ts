import { mvpHandler } from "@api/mvp";
import { sandboxDeployHandler } from "@api/sandbox-deploy";
import { githubExportHandler } from "@api/github-export";
import { json } from "@utils/log";

export interface Env {
  // Secrets injected by CI (wrangler secret put ...)
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // Non-secret var in wrangler.toml [vars]
  CF_WORKERS_SUBDOMAIN?: string;

  // Optional: allow-list a single frontend origin (Pages/custom domain)
  // e.g. "https://launchwing-app.pages.dev" or "https://app.yourdomain.com"
  ALLOW_ORIGIN?: string;

  // Static assets binding from wrangler.toml [assets] (safe to keep even if SPA moves to Pages)
  ASSETS: Fetcher;
}

type H = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

// -------------------- API routes --------------------
const routes: Record<string, Partial<Record<string, H>>> = {
  "/health": { GET: async () => json({ ok: true }) },
  "/mvp": { POST: mvpHandler },
  "/sandbox-deploy": { POST: sandboxDeployHandler },
  "/github-export": { POST: githubExportHandler }
};

// -------------------- CORS helpers --------------------
function corsHeaders(env: Env): Record<string, string> {
  // Default to a safe explicit origin if provided; as a last resort use "*"
  const origin = env.ALLOW_ORIGIN ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin"
  };
}

function withCors(env: Env, res: Response) {
  const h = new Headers(res.headers);
  const c = corsHeaders(env);
  Object.entries(c).forEach(([k, v]) => h.set(k, v));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function preflight(env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

// -------------------- Static assets / SPA fallback --------------------
async function serveAssets(req: Request, env: Env): Promise<Response> {
  // 1) Try to serve the exact asset
  const assetRes = await env.ASSETS.fetch(req);
  if (assetRes.status !== 404) return assetRes;

  // 2) If request looks like a SPA route, serve index.html
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

// -------------------- Worker entry --------------------
export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // Is this an API route we know about?
    const isApiPath = Boolean(routes[url.pathname]);

    // Handle CORS preflight for API routes
    if (isApiPath && method === "OPTIONS") {
      return preflight(env);
    }

    // API routes first
    const handler = routes[url.pathname]?.[method];
    if (handler) {
      const res = await handler(req, env, ctx);
      return withCors(env, res);
    }

    // Otherwise try to serve the SPA/assets (no CORS headers needed)
    return serveAssets(req, env);
  }
} satisfies ExportedHandler<Env>;