// app/src/hooks/useSendHandler.ts
// Generate via /api/mvp (OpenAI Responses API), store bundle, and SIMULATE a streaming
// assistant message that includes plan + CODE PREVIEWS (truncated).
// We DO NOT deploy here; Build & Deploy happens later.

import { useCallback, useRef } from "react";
import { postJSON } from "../lib/api";

type ChatRole = "system" | "user" | "assistant";
type ChatMsg = { role: ChatRole; content: string };

type MvpResp = {
  ok: boolean;
  result?: {
    ir?: {
      name?: string;
      app_type?: "spa_api" | "spa" | "api";
      pages?: string[];
      api_routes?: Array<{ method: string; path: string }>;
      notes?: string;
      features?: string[];
    };
    files?: Record<string, string>;
    artifacts?: Record<string, string>;
    smoke?: { passed: boolean; logs: string[] };
  };
  error?: string;

  // Proof fields from orchestrator
  via?: string;          // "openai-mvp-v1"
  model?: string;        // e.g., "gpt-4.1-mini"
  oai_request_id?: string | null;
  took_ms?: number;
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

const MAX_PREVIEW_BYTES = 4_000;    // ~4KB per file
const MAX_PREVIEW_LINES = 120;      // or 120 lines per file
const MAX_FILES_PREVIEW = 12;       // show up to 12 files inline

function extToLang(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".html")) return "html";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".js")) return "javascript";
  if (p.endsWith(".ts")) return "typescript";
  if (p.endsWith(".tsx")) return "tsx";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".md")) return "markdown";
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return "yaml";
  if (p.endsWith(".toml")) return "toml";
  if (p.endsWith(".sh")) return "bash";
  return "";
}

function previewOf(content: string): { text: string; truncated: boolean } {
  const byBytes = new TextEncoder().encode(content).slice(0, MAX_PREVIEW_BYTES);
  let text = new TextDecoder().decode(byBytes);
  let truncated = byBytes.length < new TextEncoder().encode(content).length;
  // also enforce line limit
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_PREVIEW_LINES) {
    text = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
    truncated = true;
  }
  return { text, truncated };
}

export function useSendHandler(opts: UseSendHandlerOpts) {
  const filesByIdea = useRef<Map<string, Record<string, string>>>(new Map());

  // Append/replace last assistant message during "streaming"
  const upsertAssistant = (id: string, fn: (prev: string) => string) => {
    opts.updateIdea(id, (prev: any) => {
      const messages: ChatMsg[] = Array.isArray(prev?.messages) ? prev.messages.slice() : [];
      if (!messages.length || messages[messages.length - 1].role !== "assistant") {
        messages.push({ role: "assistant", content: "" });
      }
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: fn(String(last.content || "")) };
      return { ...prev, messages };
    });
  };

  const simulateStream = async (id: string, fullText: string, speedMs = 12) => {
    let i = 0;
    const stepSize = Math.min(25, Math.max(10, Math.floor(fullText.length / 120))); // scale with size
    const tick = () => {
      if (i >= fullText.length) return;
      const next = fullText.slice(i, i + stepSize);
      upsertAssistant(id, (prev) => prev + next);
      i += stepSize;
      // auto-scroll
      if (opts.messageEndRef?.current) {
        opts.messageEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
      }
      if (i < fullText.length) setTimeout(tick, speedMs);
    };
    // ensure bubble exists + empty it (replace placeholder)
    upsertAssistant(id, () => "");
    setTimeout(tick, speedMs);
  };

  const handleSend = useCallback(
    async (text: string) => {
      const ideaText = String(text ?? "").trim();
      if (!ideaText) return;

      const id = opts.activeIdea?.id;
      if (!id) throw new Error("No active idea");

      const prior = Array.isArray(opts.activeIdea?.messages) ? opts.activeIdea.messages : [];

      // show user message + placeholder assistant
      opts.setLoading?.(true);
      opts.updateIdea(id, {
        messages: [
          ...prior,
          { role: "user", content: ideaText },
          { role: "assistant", content: "Generating plan and code…" },
        ],
      });

      // Build thread for context
      const thread: ChatMsg[] = [
        ...prior.map((m: any) => ({ role: m.role, content: String(m.content ?? "") })),
        { role: "user", content: ideaText },
      ];

      try {
        const data = await postJSON<MvpResp>("/api/mvp", { idea: ideaText, ideaId: id, thread });

        if (!data?.ok) {
          upsertAssistant(id, () => `❌ ${data?.error || "MVP generation failed"}`);
          return;
        }

        // Choose files map (files first, then artifacts)
        const bundle: Record<string, string> | undefined =
          (data?.result as any)?.files ??
          (data?.result as any)?.artifacts ??
          undefined;

        if (!bundle || typeof bundle !== "object" || !Object.keys(bundle).length) {
          upsertAssistant(id, () => "❌ No files returned from /api/mvp");
          return;
        }

        // Persist bundle + stage so UI can show Build & Deploy
        filesByIdea.current.set(id, bundle);
        opts.updateIdea(id, {
          bundle,
          ir: data?.result?.ir,
          currentStage: "build",
        });

        // Build transcript with plan, proof, and CODE PREVIEWS
        const ir = data?.result?.ir || {};
        const logs = data?.result?.smoke?.logs || [];
        const model = data?.model || "unknown-model";
        const reqId = data?.oai_request_id || "n/a";
        const took = (data?.took_ms ?? 0) > 0 ? `${data!.took_ms}ms` : "n/a";
        const via = data?.via ? ` (${data.via})` : "";

        const fileEntries = Object.entries(bundle);
        const totalBytes = fileEntries.reduce((acc, [, c]) => acc + new TextEncoder().encode(String(c ?? "")).length, 0);
        const fileCount = fileEntries.length;

        const ordered = fileEntries
          .map(([p, c]) => ({ path: p, content: String(c ?? ""), size: new TextEncoder().encode(String(c ?? "")).length }))
          // prioritize index and worker first, then by size desc
          .sort((a, b) => {
            const rank = (x: string) =>
              x === "index.html" ? 0 : x === "_worker.js" ? 1 : 2;
            const r = rank(a.path) - rank(b.path);
            return r !== 0 ? r : b.size - a.size;
          })
          .slice(0, MAX_FILES_PREVIEW);

        const lines: string[] = [];
        lines.push(`🤖 **OpenAI**${via}`);
        lines.push(`- Model: \`${model}\``);
        lines.push(`- Request ID: \`${reqId}\``);
        lines.push(`- Latency: \`${took}\``);
        lines.push("");
        lines.push(`### Plan: ${ir?.name || "App"}`);
        if (ir?.app_type) lines.push(`Type: \`${ir.app_type}\``);
        if (ir?.features?.length) lines.push(`Features: ${ir.features.map((f) => `\`${f}\``).join(", ")}`);
        if (ir?.pages?.length) lines.push(`Pages: ${ir.pages.map((p) => `\`${p}\``).join("  • ")}`);
        if (ir?.api_routes?.length) {
          lines.push("API routes:");
          for (const r of ir.api_routes) lines.push(`  - \`${r.method}\` \`${r.path}\``);
        }
        if (ir?.notes) {
          lines.push("");
          lines.push("Notes:");
          lines.push(ir.notes);
        }

        if (logs.length) {
          lines.push("");
          lines.push("Smoke logs:");
          for (const l of logs) lines.push(`  - ${l}`);
        }

        lines.push("");
        lines.push(`### Files Generated (${fileCount} files, ~${Math.round(totalBytes / 1024)} KB)`);
        if (fileCount > ordered.length) {
          lines.push(`Showing first ${ordered.length} files:`);
        }

        for (const { path, content, size } of ordered) {
          const { text, truncated } = previewOf(content);
          const lang = extToLang(path);
          lines.push(`#### \`${path}\` (${Math.round(size / 1024)} KB)`);
          lines.push("```" + lang);
          lines.push(text);
          lines.push("```");
          if (truncated) lines.push("_…truncated preview_");
          lines.push("");
        }

        lines.push("✅ Code bundle is ready. Click **Build & Deploy** to ship it.");

        const transcript = lines.join("\n");

        // Replace placeholder with streaming transcript
        opts.updateIdea(id, (prev: any) => {
          const messages = prev.messages.slice();
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
            messages[lastIdx] = { ...messages[lastIdx], content: "" };
          }
          return { ...prev, messages };
        });

        await simulateStream(id, transcript, 10);
      } catch (e: any) {
        upsertAssistant(id, () => `❌ ${e?.message || "Failed to generate MVP"}`);
      } finally {
        opts.setLoading?.(false);
      }
    },
    [opts.activeIdea, opts.updateIdea, opts.setLoading, opts.messageEndRef]
  );

  return { send: handleSend, filesByIdea };
}