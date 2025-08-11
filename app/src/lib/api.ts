// app/src/lib/api.ts
const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ??
  "https://launchwing-orchestrator.promptpulse.workers.dev"; // fallback

export async function post(path: string, body?: any) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}