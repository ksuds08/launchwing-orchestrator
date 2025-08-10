import { useEffect } from "react";
import ChatAssistant from "../ui/ChatAssistant";

export default function Page() {
  useEffect(() => {
    document.title = "LaunchWing Orchestrator";
  }, []);
  return (
    <main style={{ maxWidth: 960, margin: "24px auto", fontFamily: "system-ui" }}>
      <h1 style={{ marginBottom: 8 }}>LaunchWing Orchestrator</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        Chat UI (from venturepilot) wired to our new structure. This runs fully client‑side.
      </p>
      <ChatAssistant
        onReady={() => {}}
        onInitGreeting={(start) => start()}
      />
    </main>
  );
}
