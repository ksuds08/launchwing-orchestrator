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
    body: JSON.stringify(body)
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
  } catch { /* noop */ }
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

/** Simulated streaming writer */
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
    await new Promise((r) => setTimeout(r, 25));
  }
  onDone?.();
}

function withActions(msg: any, actions: Array<{ label: string; command: string }>) {
  return { ...msg, actions };
}

export function useSendHandler(args: Args) {
  const { ideas, activeIdea, updateIdea, messageEndRef, setLoading } = args;

  // Handles /build command (streams deploy logs)
  async function handleBuildCommand(threadId: string) {
    let thread = (ideas.find((i) => i.id === threadId) ?? activeIdea).messages;

    // Insert deploy placeholder
    const placeholder = { role: "assistant", content: "Starting build & deploy..." };
    updateIdea(threadId, { messages: [...thread, placeholder] });
    scrollToEnd(messageEndRef);

    try {
      await postJSON("/sandbox-deploy", { confirm: true }); // stubbed backend

      const lines = [
        "Packaging artifacts...",
        "Generating repository files",
        "Running typecheck",
        "Building SPA",
        "Bundling Worker",
        "Running smoke tests",
        "Uploading to Cloudflare",
        "Activating new version",
        "Deployment complete."
      ];
      let accum = "```log\n";
      for (const line of lines) {
        accum += line + "\n";
        // stream each line
        const current = accum + "```";
        thread = (ideas.find((i) => i.id === threadId) ?? activeIdea).messages;
        const updated = [...thread];
        updated[updated.length - 1] = { role: "assistant", content: current };
        updateIdea(threadId, { messages: updated });
        scrollToEnd(messageEndRef);
        await new Promise((r) => setTimeout(r, 300));
      }
      accum += "```";

      // Finish with a friendly summary + fake URL placeholder
      const summary =
        "\n\n**✅ Deployed.**\n" +
        "- App URL: " + "https://example-app.workers.dev" + "\n" +
        "- Repo: " + "(created via orchestrator)";

      thread = (ideas.find((i) => i.id === threadId) ?? activeIdea).messages;
      const updated = [...thread];
      updated[updated.length - 1] = { role: "assistant", content: accum + summary };
      updateIdea(threadId, { messages: updated });
    } catch (err: any) {
      thread = (ideas.find((i) => i.id === threadId) ?? activeIdea).messages;
      const updated = [...thread];
      const msg =
        "**Deploy failed:** " + (err?.message ? String(err.message) : String(err || "Unknown error"));
      updated[updated.length - 1] = { role: "assistant", content: msg };
      updateIdea(threadId, { messages: updated });
    } finally {
      setLoading(false);
      scrollToEnd(messageEndRef);
    }
  }

  return async function handleSend(content: string) {
    if (!activeIdea) return;
    const id = activeIdea.id;

    // Slash command: /build
    if (content.trim().toLowerCase() === "/build") {
      setLoading(true);
      await handleBuildCommand(id);
      return;
    }

    // 1) Optimistic user message
    const userMsg = { role: "user", content };
    updateIdea(id, { messages: [...activeIdea.messages, userMsg] });
    setLoading(true);
    scrollToEnd(messageEndRef);

    // 2) Placeholder assistant for streaming plan
    let thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
    const placeholder = { role: "assistant", content: "" };
    updateIdea(id, { messages: [...thread, placeholder] });
    scrollToEnd(messageEndRef);

    try {
      type MvpResp = {
        ok: boolean;
        result?: { ir: any; manifest: { files: string[] }; smoke: { passed: boolean; logs: string[] } };
        error?: string;
      };

      const data = await postJSON<MvpResp>("/mvp", { idea: content });
      const markdown = buildAssistantMarkdown(data);

      // 3) Stream plan content
      await streamText(
        markdown,
        (partial) => {
          thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
          const updated = [...thread];
          updated[updated.length - 1] = { role: "assistant", content: partial };
          updateIdea(id, { messages: updated });
          scrollToEnd(messageEndRef);
        }
      );

      // 4) Add action buttons to the final assistant message
      thread = (ideas.find((i) => i.id === id) ?? activeIdea).messages;
      const withBtns = [...thread];
      const last = withBtns[withBtns.length - 1];
      withBtns[withBtns.length - 1] = withActions(last, [
        { label: "Build & Deploy", command: "/build" },
        { label: "Refine Plan", command: "Can you adjust the plan to add a dashboard page?" }
      ]);
      updateIdea(id, { messages: withBtns });
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