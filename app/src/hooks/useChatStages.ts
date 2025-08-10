import { useState, useEffect, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { GREETING } from "../lib/constants";
import { initializeIdea, updateIdea as rawUpdateIdea } from "./useIdeaLifecycle";
import { useSendHandler } from "./useSendHandler";
import { useStageTransition } from "./useStageTransition";
import { useDeploymentHandler } from "./useDeploymentHandler";

export default function useChatStages(onReady?: () => void) {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [activeIdeaId, setActiveIdeaId] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [hasStreamedGreeting, setHasStreamedGreeting] = useState(false);

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const updateIdea = (id: any, updates: any) => rawUpdateIdea(setIdeas, id, updates);

  // Initialize idea with blank assistant message for streaming greeting
  useEffect(() => {
    if (!activeIdeaId && ideas.length === 0) {
      const id = uuidv4();
      const starter = initializeIdea(id);
      setIdeas([starter]);
      setActiveIdeaId(id);
    }
  }, [activeIdeaId, ideas.length]);

  const startGreetingStream = () => {
    if (hasStreamedGreeting || !activeIdeaId || ideas.length === 0) return;
    const ideaId = activeIdeaId;

    const reveal = (i: number) => {
      setIdeas(prev =>
        prev.map(idea => {
          if (idea.id !== ideaId) return idea;
          const updatedMessages = [...idea.messages];
          updatedMessages[0] = { ...updatedMessages[0], content: GREETING.slice(0, i) };
          return { ...idea, messages: updatedMessages };
        })
      );
      if (i < GREETING.length) requestAnimationFrame(() => reveal(i + 1));
      else {
        setHasStreamedGreeting(true);
        onReady?.();
      }
    };
    requestAnimationFrame(() => reveal(1));
  };

  const handleAdvanceStage = useStageTransition({
    ideas, updateIdea, setOpenPanels: () => {}, setLoading, messageEndRef
  });

  const handleConfirmBuild = useDeploymentHandler({ ideas, updateIdea, setDeployLogs });

  const activeIdea = ideas.find(i => i.id === activeIdeaId);

  const handleSend = useSendHandler({
    ideas,
    activeIdea,
    updateIdea,
    handleAdvanceStage,
    handleConfirmBuild,
    messageEndRef,
    panelRef,
    setLoading
  });

  return {
    ideas,
    activeIdeaId,
    setActiveIdeaId,
    loading,
    deployLogs,
    openPanels: { ideation: false, validation: false, branding: false },
    togglePanel: () => {},
    messageEndRef,
    panelRef,
    handleSend,
    handleAdvanceStage,
    handleConfirmBuild,
    startGreetingStream
  };
}
