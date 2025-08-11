// app/src/hooks/useDeploymentHandler.ts
// Deploys the stored bundle when the user clicks "Build & Deploy" and streams logs + final URL.

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
  updateIdea: (id: string, updates: Partial<Idea> | ((prev: any) => Partial<Idea>)) => void;
  setDeployLogs?: (logs: string[]) => void;
}) {
  const { ideas, updateIdea, setDeployLogs } = opts;

  const append = (id: string, line: string) => {
    updateIdea(id, (prev: any) => {
      const messages = Array.isArray(prev?.messages) ? prev.messages.slice() : [];
      const last = messages[messages.length - 1];
      if (last && last.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: (last.content || "") + `\n${line}` };
      } else {
        messages.push({ role: "assistant", content: line });
      }
      return { ...prev, messages };
    });
  };

  const deploy = useCallback(
    async (params?: { id?: string }) => {
      const id = params?.id || ideas[ideas.length - 1]?.id;
      const idea = ideas.find((i) => i.id === id);
      if (!id || !idea) return;

      const files = idea.bundle;
      if (!files || !Object.keys(files).length) {
        append(id, "❌ No build bundle available to deploy.");
        return;
      }

      // Preflight summary
      const entries = Object.entries(files);
      const totalBytes = entries.reduce((acc, [, c]) => acc + new TextEncoder().encode(String(c ?? "")).length, 0);
      const fileCount = entries.length;
      append(id, `🚀 Build & Deploy started (${fileCount} files, ~${Math.round(totalBytes / 1024)} KB)…`);

      const steps = [
        "Packaging artifacts…",
        "Generating repository files…",
        "Running typecheck…",
        "Building SPA…",
        "Bundling Worker…",
        "Running smoke tests…",
        "Uploading to Cloudflare…",
        "Activating new version…",
      ];
      steps.forEach((s) => append(id, s));

      try {
        const res = await postJSON<DeployResp>("/api/sandbox-deploy", {
          id,
          files,
          confirm: true,
        });

        if (Array.isArray(res?.logs)) {
          res.logs.forEach((l) => append(id, l));
          setDeployLogs?.(res.logs);
        }

        if (!res?.ok) {
          append(id, `❌ Deployment failed. ${res?.error || ""}`.trim());
          return;
        }

        append(id, "✅ Deployment complete.");
        if (res.url) append(id, `**App URL:** ${res.url}`);
        if (res.repo) append(id, `**Repo:** ${res.repo}`);
      } catch (e: any) {
        append(id, `❌ Deployment error: ${String(e?.message || e)}`);
      }
    },
    [ideas, updateIdea, setDeployLogs]
  );

  return deploy;
}