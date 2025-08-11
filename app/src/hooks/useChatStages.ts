// app/src/hooks/useChatStages.ts
import { useState, useEffect, useRef, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import type { VentureStage as StageType } from "../types";
import { GREETING } from "../constants/messages";

import { initializeIdea, updateIdea as rawUpdateIdea } from "./useIdeaLifecycle";
import { useSendHandler } from "./useSendHandler";
import { useStageTransition } from "./useStageTransition";
import useDeploymentHandler from "./useDeploymentHandler"; // default export

export default function useChatStages(onReady?: () => void) {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [activeIdeaId, setActiveIdeaId] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [hasStreamedGreeting, setHasStreamedGreeting] = useState(false);
  const [initialized, setInitialized] = useState(false); // gate sending until ready

  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [openPanels, setOpenPanels] = useState({
    ideation: false,
    validation: false,
    branding: false,
  });

  const activeIdea = ideas.find((i) => i.id === activeIdeaId) || null;

  const updateIdea = useCallback(
    (id: any, updates: any) => rawUpdateIdea(setIdeas, id, updates),
    []
  );

  // Initialize a starter idea with a blank assistant bubble
  useEffect(() => {
    if (initialized) return;
    const id = uuidv4();
    const starter = {
      id,
      title: "",
      messages: [
        {
          role: "assistant" as const,
          content: "", // for streaming greeting and first response
        },
      ],
      locked: false,
      currentStage: "ideation" as StageType,
      takeaways: {},
    };
    setIdeas([starter]);
    setActiveIdeaId(id);
    setInitialized(true);
  }, [initialized]);

  const startGreetingStream = () => {
    if (hasStreamedGreeting || !initialized || !activeIdeaId || ideas.length === 0) return;

    const greeting = GREETING;
    const ideaId = activeIdeaId;

    const reveal = (i: number) => {
      setIdeas((prevIdeas) =>
        prevIdeas.map((idea) => {
          if (idea.id !== ideaId) return idea;

          const updatedMessages = [...idea.messages];
          updatedMessages[0] = {
            ...updatedMessages[0],
            content: greeting.slice(0, i),
          };

          return { ...idea, messages: updatedMessages };
        })
      );

      if (i < greeting.length) {
        requestAnimationFrame(() => reveal(i + 1));
      } else {
        setHasStreamedGreeting(true);
        onReady?.();
      }
    };

    requestAnimationFrame(() => reveal(1));
  };

  const handleAdvanceStage = useStageTransition({
    ideas,
    updateIdea,
    setOpenPanels,
    setLoading,
    messageEndRef,
  });

  const handleConfirmBuild = useDeploymentHandler({
    ideas,
    updateIdea,
    setDeployLogs,
  });

  // Wire up /api/mvp send logic (from hook)
  const { send: sendFromHook } = useSendHandler({
    ideas,
    activeIdea,
    updateIdea,
    handleAdvanceStage,
    handleConfirmBuild,
    messageEndRef,
    panelRef,
    setLoading,
  } as any);

  // Provide a safe handleSend that always exists and guards on init/activeIdea
  const handleSend = useCallback(
    (content: string) => {
      if (!initialized) {
        console.warn("[Chat] handleSend called before initialization; ignoring.");
        return;
      }
      if (!activeIdea) {
        console.warn("[Chat] No active idea; ignoring send.");
        return;
      }
      // surface a helpful trace so we can debug easily in the browser
      console.log("[Chat] onSend → /api/mvp", {
        ideaId: activeIdea.id,
        contentPreview: String(content).slice(0, 80),
      });
      return sendFromHook(content);
    },
    [initialized, activeIdea, sendFromHook]
  );

  return {
    ideas,
    activeIdeaId,
    setActiveIdeaId,
    loading,
    deployLogs,
    openPanels,
    togglePanel: () => {},
    messageEndRef,
    panelRef,
    handleSend,            // always a function
    handleAdvanceStage,
    handleConfirmBuild,
    startGreetingStream,
    // Expose init flag if the UI ever wants to disable inputs until ready
    initialized,
  };
}