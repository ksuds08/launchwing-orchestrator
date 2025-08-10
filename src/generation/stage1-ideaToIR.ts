import type { Env } from "../index";
import type { IR } from "@types/ir";

// TODO: call model with idea-to-IR prompt and validate by JSON Schema
export async function ideaToIR(idea: string, _env: Env): Promise<IR> {
  return {
    app_type: "spa_api",
    name: "Generated App",
    features: ["forms"],
    api_routes: [
      { path: "/api/health", method: "GET" },
      { path: "/api/echo", method: "POST" }
    ],
    pages: ["/"]
  };
}
