import type { Env } from "../index";
import { json, withReqId } from "@utils/log";

export const sandboxDeployHandler = withReqId(async (_req: Request, _env: Env) => {
  // Will deploy artifacts directly using Cloudflare API in a later step.
  return json({ ok: true, note: "sandbox deploy stub" });
});
