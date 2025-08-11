// Calls the Pages origin (which proxies /api/* to the Worker via Pages Functions)
export async function post(path: string, body?: unknown) {
  // expect path like "/api/mvp"
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    // include response text for easier debugging in UI
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText}${txt ? ` — ${txt}` : ""}`);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}