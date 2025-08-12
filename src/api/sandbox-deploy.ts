import type { Env } from "../types";
import { ensurePagesProject, getPagesProject } from "../utils/cloudflare";
import { json as log } from "../utils/log";

export async function sandboxDeployHandler(req: Request, env: Env) {
  const { projectName } = await req.json<{ projectName: string }>();
  if (!projectName) return respond({ error: "projectName is required" }, 400);

  log("sandbox-deploy ensure project", { projectName });
  const project = (await getPagesProject(env, projectName)) || (await ensurePagesProject(env, projectName));

  // NOTE: actual deployments happen via the generated repo's GitHub Action
  const result = {
    ok: true,
    projectName,
    urls: {
      dashboard: `https://dash.cloudflare.com/?to=/:account/pages/view/${projectName}`
    }
  };
  return respond(result);
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}