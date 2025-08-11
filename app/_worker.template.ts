export interface Env {
  ASSETS: Fetcher;
  ORCHESTRATOR_URL?: string;
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    },
  });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    // Proxy API requests
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return corsPreflight();

      const upstreamBase =
        env.ORCHESTRATOR_URL || "https://venturepilot-api.promptpulse.workers.dev";
      const upstreamUrl = new URL(upstreamBase);
      upstreamUrl.pathname = url.pathname.replace(/^\/api/, "");
      upstreamUrl.search = url.search;

      const proxied = new Request(upstreamUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      const res = await fetch(proxied);
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(res.body, { status: res.status, headers });
    }

    // Static assets / SPA fallback
    const assetResp = await env.ASSETS.fetch(request);
    if (assetResp.status < 400) return assetResp;

    if (request.method === "GET" || request.method === "HEAD") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};