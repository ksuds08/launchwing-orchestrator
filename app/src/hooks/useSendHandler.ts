// app/src/hooks/useSendHandler.ts
// Calls /api/mvp?debug=1 and SIMULATES streaming by overwriting the assistant message.
// Renders plan + code previews + OpenAI debug payloads (truncated).

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

  // proof + debug
  via?: string;
  model?: string;
  oai_request_id?: string | null;
  took_ms?: number;
  debug_payload?: string;
  debug_raw_openai?: string;
};

type UseSendHandlerOpts = {
  ideas: any[];
  activeIdea: any | null;
  updateIdea: (id: any, updates: any) => void; // plain-object updates only
  handleAdvanceStage?: (...args: any[]) => void;
  handleConfirmBuild?: (...args: any[]) => void;
  messageEndRef?: React.RefObject<HTMLDivElement>;
  panelRef?: React.RefObject<HTMLDivElement>;
  setLoading?: (b: boolean) => void;
};

const MAX_PREVIEW_BYTES = 4_000;
const MAX_PREVIEW_LINES = 120;
const MAX_FILES_PREVIEW = 12;
const MAX_DEBUG_CHARS = 2000; // show up to ~2KB per debug block

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
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = enc.encode(content);
  const sliced = bytes.slice(0, MAX_PREVIEW_BYTES);
  let text = dec.decode(sliced);
  let truncated = sliced.length < bytes.length;
  const lines = text.split(/\r?\n/);
  if (lines.length > MAX_PREVIEW_LINES) {
    text = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
    truncated = true;
  }
  return { text, truncated };
}

export function useSendHandler(opts: UseSendHandlerOpts) {
  const filesByIdea = useRef<Map<string, Record<string, string>>>(new Map());

  const handleSend = useCallback(
    async (text: string) => {
      const ideaText = String(text ?? "").trim();
      const active = opts.activeIdea;
      if (!ideaText || !active?.id) return;
      const id = active.id;

      // Snapshot prior messages (no functional updates)
      const prior: ChatMsg[] = Array.isArray(active.messages) ? active.messages.slice() : [];

      // 1) Show user message + placeholder
      const baseMsgs: ChatMsg[] = [...prior, { role: "user", content: ideaText }];
      opts.setLoading?.(true);
      opts.updateIdea(id, { messages: [...baseMsgs, { role: "assistant", content: "Generating plan and code…" }] });

      // Helper to overwrite last assistant bubble with full text
      const renderAssistant = (full: string) => {
        opts.updateIdea(id, { messages: [...baseMsgs, { role: "assistant", content: full }] });
        if (opts.messageEndRef?.current) {
          opts.messageEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
        }
      };

      try {
        // 2) Call orchestrator with debug enabled
        const data = await postJSON<MvpResp>("/api/mvp?debug=1", {
          idea: ideaText,
          ideaId: id,
          thread: baseMsgs,
        });

        if (!data?.ok) {
          renderAssistant(`❌ ${data?.error || "MVP generation failed"}`);
          return;
        }

        // 3) Choose files map
        const bundle: Record<string, string> | undefined =
          (data?.result as any)?.files ??
          (data?.result as any)?.artifacts ??
          undefined;

        if (!bundle || !Object.keys(bundle).length) {
          renderAssistant("❌ No files returned from /api/mvp");
          return;
        }

        // Persist bundle and stage
        filesByIdea.current.set(id, bundle);
        opts.updateIdea(id, {
          bundle,
          ir: data?.result?.ir,
          currentStage: "build",
        });

        // 4) Build transcript (plan + code previews + OPENAI DEBUG)
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
          .sort((a, b) => {
            const rank = (x: string) => (x === "index.html" ? 0 : x === "_worker.js" ? 1 : 2);
            const r = rank(a.path) - rank(b.path);
            return r !== 0 ? r : b.size - a.size;
          })
          .slice(0, MAX_FILES_PREVIEW);

        const lines: string[] = [];
        const push = (s = "") => lines.push(s);

        push(`🤖 **OpenAI**${via}`);
        push(`- Model: \`${model}\``);
        push(`- Request ID: \`${reqId}\``);
        push(`- Latency: \`${took}\``);
        push("");
        push(`### Plan: ${ir?.name || "App"}`);
        if (ir?.app_type) push(`Type: \`${ir.app_type}\``);
        if (ir?.features?.length) push(`Features: ${ir.features.map((f: string) => `\`${f}\``).join(", ")}`);
        if (ir?.pages?.length) push(`Pages: ${ir.pages.map((p: string) => `\`${p}\``).join("  • ")}`);
        if (ir?.api_routes?.length) {
          push("API routes:");
          for (const r of ir.api_routes) push(`  - \`${r.method}\` \`${r.path}\``);
        }
        if (ir?.notes) {
          push("");
          push("Notes:");
          push(ir.notes);
        }
        if (logs.length) {
          push("");
          push("Smoke logs:");
          for (const l of logs) push(`  - ${l}`);
        }

        push("");
        push(`### Files Generated (${fileCount} files, ~${Math.round(totalBytes / 1024)} KB)`);
        if (fileCount > ordered.length) push(`Showing first ${ordered.length} files:`);

        for (const { path, content, size } of ordered) {
          const { text, truncated } = previewOf(content);
          const lang = extToLang(path);
          push(`#### \`${path}\` (${Math.round(size / 1024)} KB)`);
          push("```" + lang);
          push(text);
          push("```");
          if (truncated) push("_…truncated preview_");
          push("");
        }

        // --- DEBUG SECTION (raw OpenAI output) ---
        if (data?.debug_payload || data?.debug_raw_openai) {
          push("### OpenAI Debug");
          if (data.debug_payload) {
            const dp = String(data.debug_payload);
            const clip = dp.length > MAX_DEBUG_CHARS ? dp.slice(0, MAX_DEBUG_CHARS) + "… (truncated)" : dp;
            push("**Parsed payload (string)**");
            push("```json");
            push(clip);
            push("```");
          }
          if (data.debug_raw_openai) {
            const dr = String(data.debug_raw_openai);
            const clip = dr.length > MAX_DEBUG_CHARS ? dr.slice(0, MAX_DEBUG_CHARS) + "… (truncated)" : dr;
            push("**Raw OpenAI response (as returned)**");
            push("```json");
            push(clip);
            push("```");
          }
        }

        push("✅ Code bundle is ready. Click **Build & Deploy** to ship it.");

        const transcript = lines.join("\n");

        // 5) Simulated streaming: repeatedly overwrite assistant bubble
        let i = 0;
        const step = Math.min(25, Math.max(10, Math.floor(transcript.length / 120)));
        const tick = () => {
          if (i >= transcript.length) return;
          const next = transcript.slice(0, i + step);
          renderAssistant(next);
          i += step;
          setTimeout(tick, 10);
        };
        renderAssistant("");
        setTimeout(tick, 10);
      } catch (e: any) {
        renderAssistant(`❌ ${e?.message || "Failed to generate MVP"}`);
      } finally {
        opts.setLoading?.(false);
      }
    },
    [opts.activeIdea, opts.updateIdea, opts.setLoading, opts.messageEndRef]
  );

  return { send: handleSend, filesByIdea };
}