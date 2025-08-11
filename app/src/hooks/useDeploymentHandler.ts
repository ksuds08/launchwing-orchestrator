// app/src/hooks/useDeploymentHandler.ts
import { useCallback } from "react";
import { post } from "../lib/api";

type Idea = {
  id: string;
  title?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  locked?: boolean;
  deployedUrl?: string;
  meta?: Record<string, any>;
};

type Args = {
  ideas: Idea[];
  updateIdea: (id: string, updates: Partial<Idea>) => void;
  setDeployLogs: React.Dispatch<React.SetStateAction<string[]>>;
};

/**
 * Handles the “Confirm Build/Deploy” action for an idea:
 *  1) Calls /mvp to produce IR/manifest (server-side)
 *  2) Calls /sandbox-deploy to ship a minimal service
 *  3) Updates the idea with the deployed URL, locks the convo
 *
 * All network goes through post() → respects VITE_API_BASE
 */
export default function useDeploymentHandler({
  ideas,
  updateIdea,
  setDeployLogs,
}: Args) {
  const appendLog = useCallback(
    (line: string) => {
      setDeployLogs((prev) => [...prev, line]);
    },
    [setDeployLogs]
  );

  const handleConfirmBuild = useCallback(
    async (ideaId: string) => {
      const idea = ideas.find((i) => i.id === ideaId);
      if (!idea) return;

      try {
        appendLog("🔧 Generating MVP (server)...");
        // Minimal payload for /mvp — tweak as your API expects
        const ideaSummary =
          idea.title?.trim() ||
          idea.messages
            .filter((m) => m.role === "user")
            .map((m) => m.content)
            .slice(-3)
            .join("\n\n");

        const mvpPayload = { idea: ideaSummary };
        const mvp = await post("/mvp", mvpPayload as any);
        appendLog("✅ MVP generated.");

        // Try to print a quick summary if present
        const pages = Array.isArray(mvp?.ir?.pages) ? mvp.ir.pages.length : undefined;
        const files = Array.isArray(mvp?.manifest?.files)
          ? mvp.manifest.files.length
          : undefined;
        if (pages || files) {
          appendLog(
            `ℹ️  Plan: ${pages ? `${pages} page(s)` : ""}${
              pages && files ? ", " : ""
            }${files ? `${files} file(s)` : ""}`
          );
        }

        appendLog("🚀 Deploying to Cloudflare (sandbox)...");
        // /sandbox-deploy expects at least a service name; we’ll let the server derive one
        const deployPayload = {
          mvp, // pass through — server can pick what it needs
        };
        const deployRes = await post("/sandbox-deploy", deployPayload as any);

        const url: string | undefined =
          deployRes?.url ||
          deployRes?.result?.url ||
          deployRes?.result?.routes?.[0]?.pattern
            ?.replace("/*", "")
            ?.replace(/^https?:\/\//, "https://");

        if (!url) {
          appendLog("⚠️ Deploy response received but no URL was returned.");
          updateIdea(ideaId, {
            meta: { ...(idea.meta || {}), lastDeploy: deployRes },
          });
          return;
        }

        appendLog(`✅ Deployed: ${url}`);
        updateIdea(ideaId, {
          deployedUrl: url,
          locked: true,
          meta: { ...(idea.meta || {}), lastDeploy: deployRes, lastMvp: mvp },
        });
      } catch (err: any) {
        const msg =
          typeof err === "string"
            ? err
            : err?.message || "Unknown error during deploy.";
        appendLog(`❌ Deploy failed: ${msg}`);
        updateIdea(ideaId, {
          meta: { ...(ideas.find(i => i.id === ideaId)?.meta || {}), lastError: msg },
        });
      }
    },
    [ideas, appendLog, setDeployLogs, updateIdea]
  );

  return handleConfirmBuild;
}