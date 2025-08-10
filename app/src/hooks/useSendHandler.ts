export function useSendHandler(_args: any) {
  // Minimal behavior: append user message + dummy assistant reply
  return async (content: string) => {
    const { ideas, activeIdea, updateIdea } = _args;
    if (!activeIdea) return;
    const id = activeIdea.id;
    updateIdea(id, { messages: [...activeIdea.messages, { role: "user", content }] });
    updateIdea(id, { messages: [...activeIdea.messages, { role: "user", content }, { role: "assistant", content: "Got it. (stub reply)" }] });
  };
}
