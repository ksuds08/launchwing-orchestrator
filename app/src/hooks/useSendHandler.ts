import type React from "react";

type Args = {
  ideas: any[];
  activeIdea: any | undefined;
  updateIdea: (id: string, updates: any) => void;
  handleAdvanceStage?: (...args: any[]) => Promise<any>;
  handleConfirmBuild?: (...args: any[]) => Promise<any>;
  messageEndRef: React.RefObject<HTMLDivElement>;
  panelRef: React.RefObject<HTMLDivElement>;
  setLoading: (v: boolean) => void;
};

async function postJSON<T = any>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || "HTTP " + res.status);
  }
  return res.json() as Promise<T>;
}

function scrollToEnd(ref: React.RefObject<HTMLDivElement>) {
  try {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  } catch {
    /* noop */
  }
}

function buildAssistantMarkdown(data: any): string {
  if (!data?.ok || !data?.result) {
    const err = data?.error ? String(data.error) : "unknown error";
    return "**Error:** " + err;
  }
  const result = data.result || {};
  const ir = result.ir || {};
  const manifest = result.manifest || {};
  const smoke = result.smoke || {};

  const routes = Array.isArray(ir.api_routes)
    ? ir.api_routes.map((r: any) => (r.method + " " + r.path)).join(", ")
    : "—";
  const pages = Array.isArray(ir.pages) ? ir.pages.join(", ") : "—";
  const filesCount = Array.isArray(manifest.files) ? manifest.files.length : 0;
  const smokeLogs = Array.isArray(smoke.logs) && smoke.logs.length
    ? "```\n" + smoke.logs.join("\n") + "\n```"
    : "";

  let s = "";
  s += "### Plan created\n";
  s += "**App:** " + (ir.name || "Generated App") + "  \n";
  s += "**Type:** " + (ir.app_type || "spa_api") + "\n\n";
  s += "**Pages:** " + pages + "  \n";
  s += "**API Routes:** " + routes + "\n\n";
  s += "**Files to generate:** " + String(filesCount) + "\n\n";
  s += "### Smoke\n";
  s += "- Passed: **" + (smoke.passed ? "yes" : "no") + "**\n";
  if (smokeLogs) s += smokeLogs + "\n";
  s += "\n> Next: confirm to build & deploy, or iterate on the idea.";
  return s;
}

/**
 * Simulate streaming by revealing the final text in chunks.
 * - Chunks by ~30–60 chars, slightly randomized so it feels organic
 * - Uses await delay to yield between updates
 */
async function streamText(
  finalText: string,
  onChunk: (partial: string) => void,
  onDone?: () => void
) {
  const len = finalText.length;
  let i = 0;
  while (i < len) {
    const step = 30 + Math.floor(Math.random() * 30); // 30..60
    i = Math.min(i + step, len);
    onChunk(finalText.slice(0, i));
    await new Promise((r) => setTimeout(r, 25)); // ~40 chunks/sec
  }
  onDone?.();
}

export function useSendHandler(args: Args) {
  const { ideas, activeIdea, updateIdea, messageEndRef, setLoading } = args;

  return async function handleSend(content: string) {
    if (!activeIdea) return;
    const id = activeIdea.id;

    // 1) Optimistically append the user message
    const userMsg = { role: "user", content };
    updateIdea(id, { messages: [...activeIdea.messages, userMsg] });
    setLoading(true);
    scrollToEnd(messageEndRef);

    // 2) Insert a placeholder assistant message we will "stream" into
    let thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
    const placeholder = { role: "assistant", content: "" };
    updateIdea(id, { messages: [...thread, placeholder] });
    scrollToEnd(messageEndRef);

    try {
      type MvpResp = {
        ok: boolean;
        result?: {
          ir: any;
          manifest: { files: string[] };
          smoke: { passed: boolean; logs: string[] };
        };
        error?: string;
      };

      const data = await postJSON<MvpResp>("/mvp", { idea: content });
      const markdown = buildAssistantMarkdown(data);

      // 3) Stream the markdown into the last assistant message
      await streamText(
        markdown,
        (partial) => {
          // refresh current thread (avoid stale closure)
          thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
          const updated = [...thread];
          updated[updated.length - 1] = { role: "assistant", content: partial };
          updateIdea(id, { messages: updated });
          scrollToEnd(messageEndRef);
        },
        () => {
          scrollToEnd(messageEndRef);
        }
      );
    } catch (err: any) {
      thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
      const updated = [...thread];
      const msg =
        "**Request failed:** " + (err?.message ? String(err.message) : String(err || "Unknown error"));
      updated[updated.length - 1] = { role: "assistant", content: msg };
      updateIdea(id, { messages: updated });
    } finally {
      setLoading(false);
      scrollToEnd(messageEndRef);
    }
  };
}