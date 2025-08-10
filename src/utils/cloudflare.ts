// Cloudflare Workers deploy helpers (module upload, no wrangler needed)

export interface DeployResult {
  ok: boolean;
  name?: string;
  url?: string;
  deploymentId?: string;
  error?: string;
}

interface EnvLike {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKERS_SUBDOMAIN?: string;
}

/**
 * Upload a single-file Module Worker named `scriptName`, with given JS module code string.
 * Returns workers.dev URL derived from CF_WORKERS_SUBDOMAIN.
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

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(
    scriptName
  )}`;

  // Metadata for module upload
  const metadata = {
    main_module: "index.js",
    compatibility_date: "2024-11-01" // safe, modern date
  };

  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: fd
  });

  const json = await res.json<any>().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: json?.errors?.[0]?.message || `CF API ${res.status}`
    };
  }

  const workersUrl = subdomain ? `https://${scriptName}.${subdomain}.workers.dev/` : undefined;

  return {
    ok: true,
    name: scriptName,
    url: workersUrl,
    deploymentId: json?.result?.id
  };
}

/** Short, URL-safe id for script names */
export function shortId(): string {
  // 8 chars base36 from crypto
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}