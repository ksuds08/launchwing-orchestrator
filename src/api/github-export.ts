import type { Env } from "../types";
import { ensureRepo, pushFilesWithContentsAPI } from "../utils/github";
import { json } from "../utils/log";

export async function githubExportHandler(req: Request, env: Env) {
  const { repoName, private: isPrivate = true, files = {} } = await req.json<{
    repoName: string;
    private?: boolean;
    files: Record<string, string>;
  }>();

  if (!repoName) return respond({ error: "repoName is required" }, 400);

  json("GitHub export request", { repoName, count: Object.keys(files).length });

  await ensureRepo(env, repoName, isPrivate);
  const repoUrl = await pushFilesWithContentsAPI(
    env,
    repoName,
    files,
    `Initial commit via LaunchWing Orchestrator`
  );

  return respond({ ok: true, repoUrl });
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}