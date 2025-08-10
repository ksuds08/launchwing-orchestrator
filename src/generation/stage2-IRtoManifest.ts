import type { Env } from "../index";
import type { IR } from "@t/ir";
import type { FileManifest } from "@t/manifest";

export async function irToManifest(_ir: IR, _env: Env): Promise<FileManifest> {
  return {
    files: [
      "app/src/pages/index.tsx",
      "worker/src/routes/health.ts",
      "worker/src/routes/echo.ts",
      "README.md",
      "wrangler.toml"
    ]
  };
}