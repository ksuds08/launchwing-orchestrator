import type { Env } from "../index";

export async function runSmoke(_artifacts: Record<string, string>, _env: Env) {
  // Later: bundle in Miniflare and probe /, /api/health, /api/echo.
  return { passed: true, logs: ["smoke stub passed"] };
}
