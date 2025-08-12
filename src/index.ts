// src/index.ts
import { mvpHandler } from "@api/mvp";
import { sandboxDeployHandler } from "@api/sandbox-deploy";
import { githubExportHandler } from "@api/github-export";
import { json } from "@utils/log";

export interface Env {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKERS_SUBDOMAIN?: string;
  ALLOW_ORIGIN?: string;
  ASSETS: Fetcher;

  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;

  // Set by CI via `wrangler deploy --var ...`
  GIT_SHA?: string;
  GIT_REF?: string;
}

type H = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

/* -------------------- Path helpers -------------------- */
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
  const acrh = req?.headers.get("Access-Control-Request-Headers") || "Content-Type, Authorization, X-Requested-With";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": acrh,
    "Vary": "Origin",
    "x-lw-orch": "true",
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
    methods: Partial<Record<string, H>>;
    allow: string[];
  }
> = {
  "/": {
    methods: { GET: async () => json({ ok: true }) },
    allow: ["GET", "OPTIONS"],
  },
  "/health": {
    methods: {
      GET: async (_req, env) =>
        json({
          ok: true,
          hasOpenAI: Boolean(env.OPENAI_API_KEY),
          model: env.OPENAI_MODEL || null,
          version: "openai-mvp-v1",
          git_sha: env.GIT_SHA || null,
          ref: env.GIT_REF || null,
    }),
      POST: async (_req, env) =>
        json({
          ok: true,
          hasOpenAI: Boolean(env.OPENAI_API_KEY),
          model: env.OPENAI_MODEL || null,
          version: "openai-mvp-v1",
          git_sha: env.GIT_SHA || null,
          ref: env.GIT_REF || null,
    }),
    },
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
  const assetRes = await env.ASSETS.fetch(req);
  if (assetRes.status !== 404) return assetRes;

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

    if (method === "OPTIONS") return preflight(env, req);

    const route = routes[path];
    if (route) {
      const handler = route.methods[method];
      if (handler) {
        const res = await handler(req, env, ctx);
        return withCors(env, res, undefined, req);
      }
      return withCors(
        env,
        new Response("Method Not Allowed", { status: 405, headers: { Allow: route.allow.join(", ") } }),
        undefined,
        req
      );
    }

    const res = await serveAssets(req, env);
    return withCors(env, res, undefined, req);
  },
} satisfies ExportedHandler<Env>;