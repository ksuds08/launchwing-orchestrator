// app/src/hooks/useSendHandler.ts
// Generate (no deploy). Store bundle on idea and prompt user to click Build & Deploy.

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
          { role: "assistant", content: "Planning your MVP and generating the code bundle..." },
        ],
      });

      // Build thread for the model (exclude the newest placeholder assistant)
      const thread: ChatMsg[] = [
        ...prior.map((m: any) => ({ role: m.role, content: String(m.content ?? "") })),
        { role: "user", content: ideaText },
      ];

      try {
        // Call orchestrator to generate bundle
        const data = await postJSON<MvpResp>("/api/mvp", { idea: ideaText, ideaId: id, thread });
        if (!data?.ok) throw new Error(data?.error || "MVP generation failed");

        const bundle =
          (data?.result as any)?.files ??
          (data?.result as any)?.artifacts ??
          undefined;

        if (!bundle || typeof bundle !== "object" || !Object.keys(bundle).length) {
          throw new Error("No files returned from /api/mvp");
        }

        filesByIdea.current.set(id, bundle as Record<string, string>);

        // Replace placeholder assistant with instruction to click Build & Deploy
        const summaryLines = [
          "✅ Plan and code bundle generated.",
          data?.via ? `• Via: ${data.via}` : undefined,
          "• Click “Build & Deploy” to ship this to a live sandbox URL.",
        ].filter(Boolean);

        opts.updateIdea(id, {
          bundle,           // store for deploy step
          ir: data?.result?.ir,
          currentStage: "build", // helps UI show the button if your UI keys off stage
          messages: [
            ...prior,
            { role: "user", content: ideaText },
            { role: "assistant", content: summaryLines.join("\n") },
          ],
        });
      } catch (e: any) {
        opts.updateIdea(id, {
          messages: [
            ...prior,
            { role: "user", content: ideaText },
            { role: "assistant", content: `❌ ${e?.message || "Failed to generate MVP"}` },
          ],
        });
      } finally {
        opts.setLoading?.(false);
      }
    },
    [opts.activeIdea, opts.updateIdea, opts.setLoading]
  );

  return handleSend;
}