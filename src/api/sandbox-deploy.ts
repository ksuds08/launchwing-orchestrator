import type { Env } from "../index";
import { json, withReqId } from "@utils/log";
import { runGenerationStages } from "@gen/runGenerationStages";
import { deploy } from "@gen/stage6-deploy";

export const sandboxDeployHandler = withReqId(async (req: Request, env: Env) => {
  // Optional body: { idea?: string }
  const body = (await req.json().catch(() => ({}))) as any;
  const idea: string = body?.idea || "LaunchWing Sandbox App";

  // 1) Build plan + artifacts (we use IR for metadata)
  const result = await runGenerationStages({ idea }, env);

  // 2) Deploy a minimal module worker using IR details
  const deployed = await deploy(result.artifacts, env, result.ir);

  if (!deployed.ok) {
    return json({ ok: false, error: deployed.error || "deploy failed" }, 500);
  }

  // 3) Return live URL + basic info
  return json({
    ok: true,
    url: deployed.url,
    name: deployed.name,
    ir: result.ir
  });
});