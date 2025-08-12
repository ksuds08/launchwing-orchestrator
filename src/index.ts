import type { Env } from "./types";
import { healthHandler } from "./api/health";
import { mvpHandler } from "./api/mvp";
import { githubExportHandler } from "./api/github-export";
import { sandboxDeployHandler } from "./api/sandbox-deploy";
import { json as log } from "./utils/log";

function withCors(res: Response) {
  const hdrs = new Headers(res.headers);
  hdrs.set("access-control-allow-origin", "*");
  hdrs.set("access-control-allow-methods", "GET,POST,OPTIONS");
  hdrs.set("access-control-allow-headers", "content-type, authorization");
  return new Response(res.body, { ...res, headers: hdrs });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      // Simple router
      if (request.method === "GET" && path === "/health") {
        return withCors(await healthHandler(request, env));
      }
      if (request.method === "POST" && path === "/mvp") {
        return withCors(await mvpHandler(request, env));
      }
      if (request.method === "POST" && path === "/github-export") {
        return withCors(await githubExportHandler(request, env));
      }
      if (request.method === "POST" && path === "/sandbox-deploy") {
        return withCors(await sandboxDeployHandler(request, env));
      }

      return withCors(
        new Response(JSON.stringify({ error: "Not found", path }), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
      );
    } catch (err: any) {
      log("Request error", { path, error: String(err?.message || err) });
      return withCors(
        new Response(JSON.stringify({ error: String(err?.message || err) }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
      );
    }
  }
} satisfies ExportedHandler<Env>;