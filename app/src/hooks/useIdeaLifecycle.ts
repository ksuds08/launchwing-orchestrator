export function initializeIdea(id: string) {
  return {
    id,
    title: "",
    messages: [{ role: "assistant", content: "" }],
    locked: false,
    currentStage: "ideation",
    takeaways: {}
  };
}

export function updateIdea(setIdeas: Function, id: string, updates: any) {
  setIdeas((prev: any[]) => prev.map((i) => (i.id === id ? { ...i, ...updates } : i)));
}
