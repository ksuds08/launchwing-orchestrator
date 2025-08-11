const API_BASE = "https://launchwing-orchestrator.promptpulse.workers.dev";

export const onRequestPost: PagesFunction = async ({ request }) => {
  const r = await fetch(`${API_BASE}/mvp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  return new Response(r.body, {
    status: r.status,
    headers: { "content-type": r.headers.get("content-type") || "application/json" },
  });
};
