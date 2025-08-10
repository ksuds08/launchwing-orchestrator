import type { Env } from "../index";
import { json, withReqId } from "@utils/log";

export const githubExportHandler = withReqId(async (_req: Request, _env: Env) => {
  // Will create repo, push artifacts, trigger Actions in a later step.
  return json({ ok: true, note: "github export stub" });
});
