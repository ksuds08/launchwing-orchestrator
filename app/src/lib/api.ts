// app/src/lib/api.ts
function normalize(path: string): string {
  let p = (path || "").trim();
  if (!p) return "/api";
  if (p[0] !== "/") p = "/" + p;
  if (p === "/api") return p;
  if (!p.startsWith("/api/")) {
    const idx = p.indexOf("/api/");
    p = idx >= 0 ? p.slice(idx) : "/api" + (p.startsWith("/api") ? "" : p);
  }
  return p;
}

async function handle(r: Response) {
  const body = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}${body ? ` — ${body}` : ""}`);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("application/json") ? JSON.parse(body) : body;
}

export async function get(path: string) {
  const url = normalize(path);
  return handle(await fetch(url, { method: "GET" }));
}

export async function post(path: string, body?: unknown) {
  const url = normalize(path); // accepts "api/mvp", "/api/mvp", "/x/api/mvp"
  return handle(await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  }));
}