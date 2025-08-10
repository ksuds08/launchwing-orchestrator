// Cloudflare Workers deploy helpers — classic Scripts API (stable + workers_dev enable)

export interface DeployResult {
  ok: boolean;
  name?: string;
  url?: string;
  deploymentId?: string;
  error?: string;
  status?: number;
  endpoint?: string;
}

interface EnvLike {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKERS_SUBDOMAIN?: string;
}

async function cf<T = any>(
  token: string,
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Upload a single-file **Module Worker** using the classic Scripts API,
 * then explicitly enable workers.dev for that script.
 * Requires API token with "Workers Scripts: Edit".
 */
export async function uploadModuleWorker(
  scriptName: string,
  code: string,
  env: EnvLike
): Promise<DeployResult> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const subdomain = env.CF_WORKERS_SUBDOMAIN;

  if (!token || !accountId) {
    return { ok: false, error: "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" };
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(
    scriptName
  )}`;

  // 1) Upload module (multipart: metadata + index.js)
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2024-11-01",
  };

  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

  {
    const { ok, status, json } = await cf(token, base, { method: "PUT", body: fd });
    if (!ok || json?.success === false) {
      const msg =
        json?.errors?.[0]?.message ||
        json?.messages?.[0]?.message ||
        `Upload failed (${status})`;
      return { ok: false, error: msg, status, endpoint: base };
    }
  }

  // 2) Enable workers.dev for this script (required for <name>.<subdomain>.workers.dev)
  {
    const settingsUrl = `${base}/settings`;
    const body = { workers_dev: true };
    const { ok, status, json } = await cf(token, settingsUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!ok || json?.success === false) {
      const msg =
        json?.errors?.[0]?.message ||
        json?.messages?.[0]?.message ||
        `Enable workers_dev failed (${status})`;
      return { ok: false, error: msg, status, endpoint: settingsUrl };
    }
  }

  const workersUrl = subdomain ? `https://${scriptName}.${subdomain}.workers.dev/` : undefined;
  return { ok: true, name: scriptName, url: workersUrl };
}

/** Short, URL-safe id for script names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}