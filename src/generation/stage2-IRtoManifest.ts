import type { Env } from "../index";
import type { IR } from "@types/ir";
import type { FileManifest } from "@types/manifest";

export async function irToManifest(ir: IR, _env: Env): Promise<FileManifest> {
  // Minimal slot files; expand later per IR
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
