// app/src/hooks/useDeploymentHandler.ts
import { useCallback } from "react";
import { postJSON } from "../lib/api";

type DeployResp = {
  ok: boolean;
  url?: string;
  repo?: string;
  error?: string;
};

type ExportResp = {
  ok: boolean;
  repo?: string;
  url?: string;
  error?: string;
};

export function useDeploymentHandler() {
  /**
   * Deploys a files bundle to the sandbox (Cloudflare Pages via orchestrator).
   * Expects the orchestrator /sandbox-deploy endpoint to return { ok, url?, repo? }.
   */
  const deploy = useCallback(
    async (args: { id: string; files: Record<string, string> }) => {
      const res = await postJSON<DeployResp>("/api/sandbox-deploy", args);
      if (!res?.ok) throw new Error(res?.error || "Sandbox deploy failed");
      return res;
    },
    []
  );

  /**
   * Exports the files bundle to GitHub (optional repoName).
   * Maps to orchestrator /github-export.
   */
  const exportRepo = useCallback(
    async (args: { id: string; files: Record<string, string>; repoName?: string }) => {
      const res = await postJSON<ExportResp>("/api/github-export", args);
      if (!res?.ok) throw new Error(res?.error || "GitHub export failed");
      return res;
    },
    []
  );

  return { deploy, exportRepo };
}