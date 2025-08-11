// app/src/lib/api.ts
// Minimal API helpers for the UI. Works on Cloudflare Pages where /api/* is proxied
// to the orchestrator via the Advanced Mode worker.

type Jsonish = Record<string, any> | any[] | string | number | boolean | null;

function toPath(path: string): string {
  if (!path) return "/"; // safety
  // allow absolute URLs for diagnostics/local testing
  if (/^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

async function parseJsonSafe(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      // fall through
    }
  }
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

export async function getJSON<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = toPath(path);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
    },
    ...init,
  });

  const data = (await parseJsonSafe(res)) as T;
  if (!res.ok) {
    const msg = (data as any)?.error || `GET ${url} failed with ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function postJSON<T = any>(path: string, body?: Jsonish, init: RequestInit = {}): Promise<T> {
  const url = toPath(path);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...init,
  });

  const data = (await parseJsonSafe(res)) as T;
  if (!res.ok) {
    const msg = (data as any)?.error || `POST ${url} failed with ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Convenience for forms or uploads if needed later
export async function postFormJSON<T = any>(path: string, form: FormData, init: RequestInit = {}): Promise<T> {
  const url = toPath(path);
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers: {
      Accept: "application/json",
      // NOTE: do not set Content-Type; browser will set correct multipart boundary
      ...(init.headers || {}),
    },
    ...init,
  });

  const data = (await parseJsonSafe(res)) as T;
  if (!res.ok) {
    const msg = (data as any)?.error || `POST ${url} failed with ${res.status}`;
    throw new Error(msg);
  }
  return data;
}