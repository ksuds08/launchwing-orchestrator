import { mvpHandler } from "@api/mvp";
import { sandboxDeployHandler } from "@api/sandbox-deploy";
import { githubExportHandler } from "@api/github-export";
import { json } from "@utils/log";

export interface Env {
  // Add bindings as needed, e.g.:
  // OPENAI_API_KEY: string;
  // GITHUB_TOKEN: string;
  // CLOUDFLARE_ACCOUNT_ID: string;
}

type H = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

const routes: Record<string, Partial<Record<string, H>>> = {
  "/health": { GET: async () => json({ ok: true }) },
  "/mvp": { POST: mvpHandler },
  "/sandbox-deploy": { POST: sandboxDeployHandler },
  "/github-export": { POST: githubExportHandler }
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const match = routes[url.pathname]?.[method];
    if (match) return match(req, env, ctx);
    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;