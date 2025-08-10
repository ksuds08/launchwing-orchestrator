import type { Env } from "../index";

export async function deploy(_artifacts: Record<string, string>, _env: Env) {
  // Later: implement sandbox deploy or GitHub export.
  return { mode: "sandbox" as const, url: undefined };
}
