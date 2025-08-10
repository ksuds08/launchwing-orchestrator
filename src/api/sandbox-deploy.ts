import type { Env } from "../index";
import { json, withReqId } from "@utils/log";
import { runGenerationStages } from "@gen/runGenerationStages";
import { deploy } from "@gen/stage6-deploy";

/**
 * POST /sandbox-deploy
 * Body: { idea?: string }
 * Returns: { ok: true, url, name, ir } on success
 *          { ok: false, error, status?, endpoint? } on failure
 */
export const sandboxDeployHandler = withReqId(async (req: Request, env: Env) => {
  try {
    const body = (await req.json().catch(() => ({}))) as { idea?: string };
    const idea = body?.idea || "LaunchWing Sandbox App";

    // 1) Plan & build artifacts (pipeline stages 1..5)
    const result = await runGenerationStages({ idea }, env);
    // result should include: { ir, artifacts, manifest, smoke, ... }

    // 2) Deploy minimal module worker using Scripts API (stage 6)
    const deployed = await deploy(result.artifacts || {}, env, result.ir);

    if (!deployed.ok) {
      return json(
        {
          ok: false,
          error: deployed.error || "deploy failed",
          status: (deployed as any).status,
          endpoint: (deployed as any).endpoint
        },
        500
      );
    }

    // 3) Success payload (live workers.dev URL)
    return json({
      ok: true,
      url: deployed.url,
      name: deployed.name,
      ir: result.ir
    });
  } catch (err: any) {
    return json(
      {
        ok: false,
        error: err?.message || String(err || "unknown error")
      },
      500
    );
  }
});