// app/src/hooks/useDeploymentHandler.ts
// Deploys the stored bundle when the user clicks "Build & Deploy" and streams logs into chat.

import { useCallback } from "react";
import { postJSON } from "../lib/api";

type DeployResp = {
  ok: boolean;
  url?: string;
  repo?: string;
  error?: string;
  logs?: string[];
};

type UseDeploymentHandlerOpts = {
  ideas: any[];
  updateIdea: (id: any, updates: any) => void;
  setDeployLogs?: (logs: string[]) => void;
};

function useDeploymentHandler(opts: UseDeploymentHandlerOpts) {
  const appendLog = (id: string, line: string) => {
    opts.updateIdea(id, (prev: any) => {
      const prevMsgs = Array.isArray(prev?.messages) ? prev.messages : [];
      const msg = { role: "assistant" as const, content: line };
      return { ...prev, messages: [...prevMsgs, msg] };
    });
  };

  const deploy = useCallback(
    async (args?: { id?: string }) => {
      // Choose idea id: passed in or the last one with a bundle
      let id = args?.id;
      if (!id) {
        const withBundle = opts.ideas.filter((i: any) => i?.bundle && Object.keys(i.bundle).length);
        id = withBundle[withBundle.length - 1]?.id;
      }
      if (!id) throw new Error("Nothing to deploy—no generated bundle found.");

      // Read bundle from idea state
      const idea = opts.ideas.find((i: any) => i.id === id);
      const files: Record<string, string> | undefined = idea?.bundle;
      if (!files || !Object.keys(files).length) {
        throw new Error("Missing files for deploy.");
      }

      // Show progress logs similar to your previous UI
      const steps = [
        "Packaging artifacts...",
        "Generating repository files",
        "Running typecheck",
        "Building SPA",
        "Bundling Worker",
        "Running smoke tests",
        "Uploading to Cloudflare",
        "Activating new version",
        "Deployment complete.",
      ];
      appendLog(id, steps[0]);

      try {
        // Send deploy request (confirm:true is required by the orchestrator)
        const res = await postJSON<DeployResp>("/api/sandbox-deploy", {
          id,
          files,
          confirm: true,
        });

        // Append server-provided logs if present
        if (Array.isArray(res?.logs)) {
          res.logs.forEach((l) => appendLog(id!, l));
        } else {
          // Otherwise, append our canned steps
          steps.slice(1).forEach((l) => appendLog(id!, l));
        }

        if (!res?.ok) {
          appendLog(id, `❌ ${res?.error || "Sandbox deploy failed"}`);
          throw new Error(res?.error || "Sandbox deploy failed");
        }

        // Final success message
        const summary = [
          "✅ Deployed.",
          res.url ? `• App URL: ${res.url}` : undefined,
          res.repo ? `• Repo: ${res.repo}` : undefined,
        ]
          .filter(Boolean)
          .join("\n");

        appendLog(id, summary);

        // Persist url/repo on the idea
        opts.updateIdea(id, { deployedUrl: res.url, repoUrl: res.repo });

        return res;
      } catch (e: any) {
        appendLog(id, `❌ ${e?.message || "Deployment error"}`);
        throw e;
      }
    },
    [opts.ideas, opts.updateIdea]
  );

  // Shape used by useChatStages (button calls this)
  return (params?: { id?: string }) => deploy(params);
}

export default useDeploymentHandler;
export { useDeploymentHandler };