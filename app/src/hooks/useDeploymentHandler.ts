// app/src/hooks/useDeploymentHandler.ts
// Streams deployment steps by rewriting a single assistant message.
// Uses ONLY plain-object updates (no functional updates).

import { useCallback } from "react";
import { postJSON } from "../lib/api";

type DeployResp = {
  ok: boolean;
  url?: string;
  repo?: string;
  error?: string;
  logs?: string[];
};

type Idea = {
  id: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  bundle?: Record<string, string>;
};

export default function useDeploymentHandler(opts: {
  ideas: Idea[];
  updateIdea: (id: string, updates: Partial<Idea>) => void; // plain-object only
  setDeployLogs?: (logs: string[]) => void;
}) {
  const { ideas, updateIdea, setDeployLogs } = opts;

  return useCallback(
    async (params?: { id?: string }) => {
      const id = params?.id || ideas[ideas.length - 1]?.id;
      const idea = ideas.find((i) => i.id === id);
      if (!id || !idea) return;

      const files = idea.bundle;
      if (!files || !Object.keys(files).length) {
        // append a fresh assistant bubble with error
        const base = Array.isArray(idea.messages) ? idea.messages.slice() : [];
        updateIdea(id, { messages: [...base, { role: "assistant", content: "❌ No build bundle available to deploy." }] });
        return;
      }

      // Prepare a single assistant bubble we will keep overwriting
      const base = Array.isArray(idea.messages) ? idea.messages.slice() : [];
      let transcript = "";
      const flush = () =>
        updateIdea(id, { messages: [...base, { role: "assistant", content: transcript }] });

      const push = (line: string) => {
        transcript += (transcript ? "\n" : "") + line;
        flush();
      };

      // Preflight summary
      const entries = Object.entries(files);
      const totalBytes = entries.reduce((acc, [, c]) => acc + new TextEncoder().encode(String(c ?? "")).length, 0);
      const fileCount = entries.length;

      push(`🚀 Build & Deploy started (${fileCount} files, ~${Math.round(totalBytes / 1024)} KB)…`);
      [
        "Packaging artifacts…",
        "Generating repository files…",
        "Running typecheck…",
        "Building SPA…",
        "Bundling Worker…",
        "Running smoke tests…",
        "Uploading to Cloudflare…",
        "Activating new version…",
      ].forEach(push);

      try {
        const res = await postJSON<DeployResp>("/api/sandbox-deploy", { id, files, confirm: true });

        if (Array.isArray(res?.logs)) {
          res.logs.forEach(push);
          setDeployLogs?.(res.logs);
        }

        if (!res?.ok) {
          push(`❌ Deployment failed. ${res?.error || ""}`.trim());
          return;
        }

        push("✅ Deployment complete.");
        if (res.url) push(`**App URL:** ${res.url}`);
        if (res.repo) push(`**Repo:** ${res.repo}`);
      } catch (e: any) {
        push(`❌ Deployment error: ${String(e?.message || e)}`);
      }
    },
    [ideas, updateIdea, setDeployLogs]
  );
}