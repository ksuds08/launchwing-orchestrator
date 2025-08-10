import type { Env } from "../index";
import type { IR } from "@t/ir";
import { uploadModuleWorker, shortId, type DeployResult } from "@utils/cloudflare";

/** HTML escapable for embedding values in the generated landing page */
function escapeHtmlTs(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]
  );
}

/**
 * For MVP sandbox, we deploy a minimal single-file Module Worker that:
 * - serves a simple HTML landing at "/"
 * - exposes /api/health and /api/echo
 * This avoids bundling the React SPA and still gives the user a live URL.
 */
export async function deploy(artifacts: Record<string, string>, env: Env, ir?: IR): Promise<DeployResult> {
  const nameBase =
    (ir?.name || "app").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 24) || "app";
  const scriptName = `${nameBase}-${shortId()}`;

  // Pull some details from IR/artifacts to show on the landing page
  const appName = ir?.name || "Generated App";
  const appType = ir?.app_type || "spa_api";
  const pages = Array.isArray(ir?.pages) ? ir!.pages.join(", ") : "/";
  const routes = Array.isArray(ir?.api_routes) ? ir!.api_routes.map((r) => `${r.method} ${r.path}`).join(", ") : "—";

  // Pre-escape for HTML; JSON values we’ll inject via JSON.stringify
  const appNameHtml = escapeHtmlTs(appName);
  const appTypeHtml = escapeHtmlTs(appType);
  const pagesHtml = escapeHtmlTs(pages);
  const routesHtml = escapeHtmlTs(routes);

  // Minimal Module Worker code string (ES module)
  const code = `
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      const html =
\`<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${appNameHtml}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:2rem;line-height:1.5;max-width:860px}
code{background:#f6f7f9;padding:.2rem .35rem;border-radius:.25rem}
pre{background:#0b1021;color:#e8eaf6;padding:12px;border-radius:8px;overflow:auto}</style>
</head><body>
<h1>${appNameHtml}</h1>
<p><strong>Type:</strong> ${appTypeHtml}</p>
<p><strong>Pages:</strong> ${pagesHtml}</p>
<p><strong>API Routes:</strong> ${routesHtml}</p>
<p>This is a sandbox deployment created by LaunchWing Orchestrator.</p>
<hr>
<p>Try: <code>GET /api/health</code> or send <code>{"message":"hi"}</code> to <code>POST /api/echo</code>.</p>
</body></html>\`;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return new Response(JSON.stringify({ ok: true, service: ${JSON.stringify(appName)} }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url.pathname === "/api/echo" && req.method === "POST") {
      try {
        const b = await req.json();
        return new Response(JSON.stringify({ ok: true, data: b }), {
          headers: { "content-type": "application/json" }
        });
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
    }
    return new Response("Not found", { status: 404 });
  }
}
`.trim();

  const result = await uploadModuleWorker(scriptName, code, env as unknown as Record<string, string>);
  return result;
}