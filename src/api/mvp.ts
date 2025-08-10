import type { Env } from "../index";
import { runGenerationStages } from "@gen/runGenerationStages";
import { json, withReqId } from "@utils/log";

export const mvpHandler = withReqId(async (req: Request, env: Env) => {
  const body = await req.json().catch(() => ({}));
  const idea: string = body?.idea ?? "";
  if (!idea) return json({ ok: false, error: "Missing 'idea' in body" }, 400);

  const result = await runGenerationStages({ idea }, env);
  return json({ ok: true, result });
});
