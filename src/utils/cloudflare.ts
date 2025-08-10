// Cloudflare Workers deploy helpers — classic Scripts API (single upload, workers_dev enabled)

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

async function cf(
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
 * Upload a single-file **Module Worker** using the classic Scripts API.
 * We embed `workers_dev: true` in the metadata so the script is reachable at
 * https://<name>.<subdomain>.workers.dev/ immediately after upload.
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

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(
    scriptName
  )}`;

  // ── Multipart payload: metadata + main module
  // NOTE: include workers_dev here (important!)
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2024-11-01",
    workers_dev: true,             // ← enables <name>.<subdomain>.workers.dev
  };

  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
  fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

  const { ok, status, json } = await cf(token, endpoint, { method: "PUT", body: fd });

  if (!ok || json?.success === false) {
    const msg =
      json?.errors?.[0]?.message ||
      json?.messages?.[0]?.message ||
      `Upload failed (${status})`;
    return { ok: false, error: msg, status, endpoint };
  }

  const workersUrl = subdomain ? `https://${scriptName}.${subdomain}.workers.dev/` : undefined;
  return { ok: true, name: scriptName, url: workersUrl, status, endpoint };
}

/** Short, URL-safe id for service/script names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}