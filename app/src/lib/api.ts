// Calls the Pages origin (which proxies /api/* to the Worker via Pages Functions)
function normalize(p: string) {
  if (!p) return "/api";
  // ensure leading slash
  if (p[0] !== "/") p = "/" + p;
  // ensure it begins with /api/
  if (!p.startsWith("/api/") && p !== "/api") p = "/api" + (p.startsWith("/api") ? "" : p);
  return p;
}

export async function post(path: string, body?: unknown) {
  const url = normalize(path); // e.g. "/api/mvp"
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status} ${r.statusText}${txt ? ` — ${txt}` : ""}`);
  }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? r.json() : r.text();
}