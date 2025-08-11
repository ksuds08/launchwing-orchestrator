// app/src/hooks/useSendHandler.ts
// Returns a callable send handler that:
//  1) Appends the user's message to the active idea
//  2) Calls /api/mvp to generate files
//  3) Calls /api/sandbox-deploy to deploy
//  4) Replaces the placeholder assistant message with a result summary
// Accepts either `files` or `artifacts` from the API.

import { useCallback, useRef } from "react";
import { postJSON } from "../lib/api";

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type MvpResp = {
  ok: boolean;
  result?: {
    ir: any;
    files?: Record<string, string>;
    artifacts?: Record<string, string>;
    smoke: { passed: boolean; logs: string[] };
  };
  error?: string;
  via?: string;
};

type DeployResp = {
  ok: boolean;
  url?: string;
  repo?: string;
  error?: string;
};

type UseSendHandlerOpts = {
  ideas: any[];
  activeIdea: any | null;
  updateIdea: (id: any, updates: any) => void;
  handleAdvanceStage?: (...args: any[]) => void;
  handleConfirmBuild?: (...args: any[]) => void;
  messageEndRef?: React.RefObject<HTMLDivElement>;
  panelRef?: React.RefObject<HTMLDivElement>;
  setLoading?: (b: boolean) => void;
};

export function useSendHandler(opts: UseSendHandlerOpts) {
  const filesByIdea = useRef<Map<string, Record<string, string>>>(new Map());

  // Core call that hits the orchestrator
  const generateAndDeploy = useCallback(
    async (args: { id: string; idea: string; ideaId?: string; thread?: ChatMsg[] }) => {
      const { id, idea, ideaId, thread } = args;

      // 1) Generate MVP
      const data = await postJSON<MvpResp>("/api/mvp", { idea, ideaId, thread });
      if (!data?.ok) throw new Error(data?.error || "MVP generation failed");

      // Accept either `files` or `artifacts`
      const bundle =
        (data?.result as any)?.files ??
        (data?.result as any)?.artifacts ??
        undefined;

      if (!bundle || typeof bundle !== "object" || !Object.keys(bundle).length) {
        throw new Error("No files returned from /api/mvp");
      }

      // Stash bundle for this idea
      filesByIdea.current.set(id, bundle as Record<string, string>);

      // 2) Deploy to sandbox
      const deploy = await postJSON<DeployResp>("/api/sandbox-deploy", { id, files: bundle });
      if (!deploy?.ok) throw new Error(deploy?.error || "Sandbox deploy failed");

      return {
        via: data?.via,
        ir: data?.result?.ir,
        smoke: data?.result?.smoke,
        url: deploy?.url,
        repo: deploy?.repo,
        files: bundle as Record<string, string>,
      };
    },
    []
  );

  // The function `useChatStages` expects to call
  const handleSend = useCallback(
    async (text: string) => {
      const ideaText = String(text ?? "").trim();
      if (!ideaText) return;

      const id = opts.activeIdea?.id;
      if (!id) throw new Error("No active idea");

      const prior = Array.isArray(opts.activeIdea?.messages) ? opts.activeIdea.messages : [];

      // Show user message + placeholder assistant while working
      opts.setLoading?.(true);
      opts.updateIdea(id, {
        messages: [
          ...prior,
          { role: "user", content: ideaText },
          { role: "assistant", content: "Working on your MVP and deployment..." },
        ],
      });

      // Build thread for the model (exclude the newest placeholder assistant)
      const thread: ChatMsg[] = [
        ...prior.map((m: any) => ({ role: m.role, content: String(m.content ?? "") })),
        { role: "user", content: ideaText },
      ];

      try {
        const res = await generateAndDeploy({ id, idea: ideaText, ideaId: id, thread });

        // Replace the placeholder assistant message with results
        const summaryLines = [
          "✅ Built and deployed your MVP.",
          res.url ? `• URL: ${res.url}` : undefined,
          res.repo ? `• Repo: ${res.repo}` : undefined,
          res.via ? `• Via: ${res.via}` : undefined,
        ].filter(Boolean);

        opts.updateIdea(id, {
          bundle: res.files,
          ir: res.ir,
          messages: [
            ...prior,
            { role: "user", content: ideaText },
            { role: "assistant", content: summaryLines.join("\n") || "Done." },
          ],
        });
      } catch (e: any) {
        // Replace placeholder with the error
        opts.updateIdea(id, {
          messages: [
            ...prior,
            { role: "user", content: ideaText },
            { role: "assistant", content: `❌ ${e?.message || "Failed to build/deploy"}` },
          ],
        });
      } finally {
        opts.setLoading?.(false);
      }
    },
    [opts.activeIdea, opts.updateIdea, opts.setLoading, generateAndDeploy]
  );

  return handleSend;
}