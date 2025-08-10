import type { Env } from "../index";
import type { IR } from "@t/ir";

// TODO: Add prompt + JSON Schema validation
export async function ideaToIR(idea: string, _env: Env): Promise<IR> {
  const name = (idea || "Generated App").slice(0, 40);
  return {
    app_type: "spa_api",
    name,
    features: ["forms"],
    api_routes: [
      { path: "/api/health", method: "GET" },
      { path: "/api/echo", method: "POST" }
    ],
    pages: ["/"]
  };
}