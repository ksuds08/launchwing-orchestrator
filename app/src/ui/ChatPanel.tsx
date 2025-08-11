import { useState, KeyboardEvent, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
// @ts-ignore
import remarkGfm from "remark-gfm";

export interface ChatAction {
  label: string;
  command: string;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
  imageUrl?: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (content: string) => void;
  onDeploy?: () => void;                 // <-- new
  loading: boolean;
  idea: any;
  isActive: boolean;
  onClick: () => void;
  disabled: boolean;
}

export default function ChatPanel({
  messages,
  onSend,
  onDeploy,
  loading,
  idea,
  isActive,
  onClick,
  disabled,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Show Build & Deploy when we have a generated bundle OR we’re in the build stage
  const hasBundle = !!(idea?.bundle && Object.keys(idea.bundle).length);
  const showDeploy = hasBundle || idea?.currentStage === "build";

  return (
    <div
      className={`rounded-2xl shadow-lg p-6 border ${isActive ? "border-blue-500" : "border-gray-200"} bg-white`}
      onClick={onClick}
    >
      <div ref={containerRef} className="mb-4 max-h-96 overflow-y-auto space-y-4">
        {messages.map((msg, idx) => (
          <div key={idx} className="space-y-1">
            <div
              className={`p-4 rounded-xl whitespace-pre-wrap text-sm md:text-base ${
                msg.role === "user" ? "bg-gray-100 text-right" : "bg-blue-50 text-left"
              }`}
            >
              {msg.content.length > 0 && (
                <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm break-words max-w-full">
                  {msg.content}
                </ReactMarkdown>
              )}
              {msg.imageUrl && (
                <div className="mt-2">
                  <img src={msg.imageUrl} alt="" className="max-w-full h-auto rounded-md" />
                </div>
              )}
            </div>

            {msg.actions && (
              <div className="flex flex-wrap gap-2 mt-1">
                {msg.actions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => onSend(action.command)}
                    className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-medium px-4 py-1.5 rounded-md text-sm shadow-md hover:opacity-90 disabled:opacity-50 transition"
                    disabled={loading || disabled}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="text-gray-400 text-sm font-mono flex items-center gap-1">
            <span>Thinking</span><span className="animate-pulse">.</span>
            <span className="animate-pulse delay-150">.</span>
            <span className="animate-pulse delay-300">.</span>
          </div>
        )}
      </div>

      {/* Build & Deploy button */}
      {showDeploy && (
        <div className="flex items-center justify-start gap-2 mb-3">
          <button
            className="bg-green-600 text-white font-medium px-4 py-2 rounded-md shadow-md hover:opacity-90 disabled:opacity-50 transition"
            onClick={() => onDeploy && onDeploy()}
            disabled={disabled || loading || !hasBundle}
            title={hasBundle ? "Build & Deploy this bundle" : "Bundle not ready yet"}
          >
            Build &amp; Deploy
          </button>
          {!hasBundle && (
            <span className="text-xs text-gray-500">Preparing bundle…</span>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 pt-2 border-t mt-4">
        <textarea
          className="flex-1 border rounded-md p-2 text-sm resize-none shadow-sm"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || loading}
          placeholder={disabled ? "Conversation locked" : "Type a message…"}
        />
        <button
          className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white font-medium px-4 py-2 rounded-md shadow-md hover:opacity-90 disabled:opacity-50 transition"
          onClick={sendMessage}
          disabled={disabled || loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}