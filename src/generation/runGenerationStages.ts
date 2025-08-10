import type { Env } from "../index";
import type { IR } from "@types/ir";
import type { FileManifest } from "@types/manifest";
import { ideaToIR } from "./stage1-ideaToIR";
import { irToManifest } from "./stage2-IRtoManifest";
import { generateFiles } from "./stage3-generateFiles";
import { repairIfNeeded } from "./stage4-repair";
import { runSmoke } from "./stage5-smoke";
import { deploy } from "./stage6-deploy";

export interface RunInput { idea: string }
export interface RunOutput {
  ir: IR;
  manifest: FileManifest;
  artifacts: Record<string, string>;
  smoke: { passed: boolean; logs: string[] };
  deployment?: { mode: "sandbox" | "github"; url?: string; repoUrl?: string };
}

export async function runGenerationStages(input: RunInput, env: Env): Promise<RunOutput> {
  const ir = await ideaToIR(input.idea, env);
  const manifest = await irToManifest(ir, env);
  let artifacts = await generateFiles(ir, manifest, env);

  const repaired = await repairIfNeeded(artifacts, env);
  if (repaired) artifacts = repaired;

  const smoke = await runSmoke(artifacts, env);
  // NOTE: We’re not auto-deploying in this stub; return artifacts + smoke for now.
  return { ir, manifest, artifacts, smoke };
}
