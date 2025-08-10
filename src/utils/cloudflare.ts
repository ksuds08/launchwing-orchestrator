// Cloudflare Workers deploy helpers using the Services API (workers_dev enabled)

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

async function cf<T>(
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
 * Idempotently create/update a Worker Service, upload a module build to the
 * "production" environment, and enable workers.dev for it.
 */
export async function uploadModuleWorker(
  serviceName: string,
  code: string,
  env: EnvLike
): Promise<DeployResult> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const subdomain = env.CF_WORKERS_SUBDOMAIN;

  if (!token || !accountId) {
    return { ok: false, error: "Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID" };
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${encodeURIComponent(serviceName)}`;

  // 1) Ensure the service exists (idempotent)
  {
    const { ok, status, json } = await cf(token, base, { method: "PUT" });
    if (!ok && status !== 409) {
      // 409 means "already exists", which is fine
      return { ok: false, error: json?.errors?.[0]?.message || `Create service failed (${status})` };
    }
  }

  // 2) Upload module code to production environment
  {
    const metadata = {
      main_module: "index.js",
      compatibility_date: "2024-11-01",
    };

    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

    const { ok, status, json } = await cf(
      token,
      `${base}/environments/production/script`,
      { method: "PUT", body: fd }
    );
    if (!ok) {
      return { ok: false, error: json?.errors?.[0]?.message || `Upload script failed (${status})` };
    }
  }

  // 3) Enable workers.dev on production env
  {
    const body = { workers_dev: true };
    const { ok, status, json } = await cf(
      token,
      `${base}/environments/production/settings`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (!ok) {
      return { ok: false, error: json?.errors?.[0]?.message || `Enable workers_dev failed (${status})` };
    }
  }

  // 4) Return the workers.dev URL
  const url = subdomain ? `https://${serviceName}.${subdomain}.workers.dev/` : undefined;
  return { ok: true, name: serviceName, url };
}

/** Short, URL-safe id for service names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}