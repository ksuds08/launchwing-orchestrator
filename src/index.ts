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

  // Static assets binding from wrangler.toml [assets]
  ASSETS: Fetcher;
}

type H = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Partial<Record<string, H>>> = {
  "/health": { GET: async () => json({ ok: true }) },
  "/mvp": { POST: mvpHandler },
  "/sandbox-deploy": { POST: sandboxDeployHandler },
  "/github-export": { POST: githubExportHandler }
};

// Serve static assets and SPA fallback to /index.html
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

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();

    // API routes first
    const match = routes[url.pathname]?.[method];
    if (match) return match(req, env, ctx);

    // Otherwise try to serve the SPA/assets
    return serveAssets(req, env);
  }
} satisfies ExportedHandler<Env>;