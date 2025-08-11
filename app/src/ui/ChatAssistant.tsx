import { useEffect } from "react";
import ChatPanel from "./ChatPanel";
import useChatStages from "../hooks/useChatStages";

type ChatAssistantProps = {
  onReady?: () => void;
  onInitGreeting?: (startGreeting: () => void) => void;
};

export default function ChatAssistant({ onReady, onInitGreeting }: ChatAssistantProps) {
  const {
    ideas,
    activeIdeaId,
    setActiveIdeaId,
    loading,
    messageEndRef,
    handleSend,
    handleConfirmBuild, // <-- deploy handler
    startGreetingStream,
  } = useChatStages(onReady);

  useEffect(() => {
    if (onInitGreeting) onInitGreeting(startGreetingStream);
  }, [onInitGreeting, startGreetingStream]);

  const activeIdea = ideas.find((i) => i.id === activeIdeaId);

  return (
    <div className="flex flex-col gap-8 mt-6 px-2">
      <div className="flex flex-col w-full">
        {ideas.map((idea: any) => (
          <div key={idea.id} className="mb-6">
            <ChatPanel
              messages={idea.messages}
              onSend={(msg) => {
                setActiveIdeaId(idea.id);
                handleSend(msg);
              }}
              onDeploy={() => {
                setActiveIdeaId(idea.id);
                // trigger deploy of this idea’s generated bundle
                handleConfirmBuild({ id: idea.id });
              }}
              loading={loading && idea.id === activeIdeaId}
              idea={idea}
              isActive={idea.id === activeIdeaId}
              onClick={() => setActiveIdeaId(idea.id)}
              disabled={idea.locked}
            />
          </div>
        ))}
        <div ref={messageEndRef as any} />
      </div>
      {!activeIdea && <div style={{ color: "#888" }}>No active conversation.</div>}
    </div>
  );
}