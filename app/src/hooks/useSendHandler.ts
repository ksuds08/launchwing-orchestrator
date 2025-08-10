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
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function scrollToEnd(ref: React.RefObject<HTMLDivElement>) {
  try {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  } catch { /* noop */ }
}

export function useSendHandler(args: Args) {
  const {
    ideas,
    activeIdea,
    updateIdea,
    messageEndRef,
    setLoading
  } = args;

  return async function handleSend(content: string) {
    if (!activeIdea) return;
    const id = activeIdea.id;

    // 1) Optimistic user message
    const userMsg = { role: "user", content };
    updateIdea(id, { messages: [...activeIdea.messages, userMsg] });
    setLoading(true);
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

      // 3) Assistant reply (no nested backticks)
      let assistant = "Something went wrong.";
      if (data.ok && data.result) {
        const { ir, manifest, smoke } = data.result;
        const routes = Array.isArray(ir?.api_routes)
          ? ir.api_routes.map((r: any) => r.method + " " + r.path).join(", ")
          : "—";
        const pages = Array.isArray(ir?.pages) ? ir.pages.join(", ") : "—";
        const filesCount = Array.isArray(manifest?.files) ? manifest.files.length : 0;
        const smokeLogs = Array.isArray(smoke?.logs) && smoke.logs.length
          ? "```\n" + smoke.logs.join("\n") + "\n```"
          : "";

        assistant =
`### Plan created
**App:** ${ir?.name ?? "Generated App"}
**Type:** ${ir?.app_type ?? "spa_api"}

**Pages:** ${pages}
**API Routes:** ${routes}

**Files to generate:** ${filesCount}

### Smoke
- Passed: **${smoke?.passed ? "yes" : "no"}**
${smokeLogs}

> Next: confirm to build & deploy, or iterate on the idea.`;
      } else {
        assistant = `**Error:** ${data.error ?? "unknown error"}`;
      }

      // 4) Append assistant reply
      const next = (ideas.find(i => i.id === id) ?? activeIdea).messages;
      updateIdea(id, { messages: [...next, { role: "assistant", content: assistant }] });
    } catch (err: any) {
      const next = (ideas.find(i => i.id === id) ?? activeIdea).messages;
      updateIdea(id, {
        messages: [
          ...next,
          { role: "assistant", content: `**Request failed:** ${err?.message || String(err)}` }
        ]
      });
    } finally {
      setLoading(false);
      scrollToEnd(messageEndRef);
    }
  };
}