import type { Env } from "../types";

export async function healthHandler(_req: Request, env: Env) {
  const body = {
    ok: true,
    time: new Date().toISOString(),
    git: { ref: env.GIT_REF, sha: env.GIT_SHA },
    env: {
      openai: !!env.OPENAI_API_KEY,
      github: !!env.GITHUB_TOKEN && !!env.GITHUB_ORG,
      cloudflare: !!env.CLOUDFLARE_API_TOKEN && !!env.CLOUDFLARE_ACCOUNT_ID,
      orchestrator_url: env.ORCHESTRATOR_URL || null
    }
  };
  return json(body, 200);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}