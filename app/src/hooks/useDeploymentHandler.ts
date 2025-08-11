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

/**
 * Hook that wraps orchestrator deploy/export endpoints.
 * Keeps the API small and stable for callers like useChatStages().
 */
function useDeploymentHandler() {
  /**
   * Deploys a files bundle to the sandbox (Cloudflare Pages via orchestrator).
   * Maps to /api/sandbox-deploy (proxied by Pages worker).
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
   * Maps to /api/github-export (proxied by Pages worker).
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

export default useDeploymentHandler;
export { useDeploymentHandler };