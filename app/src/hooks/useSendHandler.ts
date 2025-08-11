// app/src/hooks/useSendHandler.ts
// Sends the idea to /api/mvp, stores the returned bundle, then triggers /api/sandbox-deploy.
// Updated to accept either `files` or `artifacts` in the result.

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

export function useSendHandler() {
  const filesByIdea = useRef<Map<string, Record<string, string>>>(new Map());

  const send = useCallback(
    async (opts: { id: string; idea?: string; ideaId?: string; thread?: ChatMsg[] }) => {
      const { id, idea, ideaId, thread } = opts;

      // 1) Generate MVP
      const data = await postJSON<MvpResp>("/api/mvp", {
        idea,
        ideaId,
        thread,
      });

      if (!data?.ok) {
        throw new Error(data?.error || "MVP generation failed");
      }

      // Accept either `files` or `artifacts`
      const bundle =
        (data?.result as any)?.files ??
        (data?.result as any)?.artifacts ??
        undefined;

      if (!bundle || typeof bundle !== "object" || !Object.keys(bundle).length) {
        throw new Error("No files returned from /api/mvp");
      }

      // Store bundle for this idea
      filesByIdea.current.set(id, bundle as Record<string, string>);

      // 2) Deploy to sandbox
      const deploy = await postJSON<DeployResp>("/api/sandbox-deploy", {
        id,
        files: bundle,
      });

      if (!deploy?.ok) {
        throw new Error(deploy?.error || "Sandbox deploy failed");
      }

      return {
        via: data?.via,
        ir: data?.result?.ir,
        smoke: data?.result?.smoke,
        url: deploy?.url,
        repo: deploy?.repo,
        files: bundle,
      };
    },
    []
  );

  return { send, filesByIdea };
}