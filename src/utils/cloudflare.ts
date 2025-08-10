// Cloudflare Workers deploy helpers — Services API with workers_dev + health check

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

type CfResp = { ok: boolean; status: number; json: any };

async function cf(token: string, url: string, init: RequestInit): Promise<CfResp> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

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

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${encodeURIComponent(
    serviceName
  )}`;

  // 1) Ensure service exists (idempotent)
  {
    const r = await cf(token, base, { method: "PUT" });
    if (!r.ok && r.status !== 409) {
      const msg = r.json?.errors?.[0]?.message ?? `Create service failed (${r.status})`;
      return { ok: false, error: msg };
    }
  }

  // 2) Upload module to production
  {
    const metadata = { main_module: "index.js", compatibility_date: "2024-11-01" };
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

    const r = await cf(token, `${base}/environments/production/script`, { method: "PUT", body: fd });
    if (!r.ok) {
      const msg = r.json?.errors?.[0]?.message ?? `Upload script failed (${r.status})`;
      return { ok: false, error: msg };
    }
  }

  // 3) Enable workers.dev
  {
    const r = await cf(token, `${base}/environments/production/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workers_dev: true }),
    });
    if (!r.ok) {
      const msg = r.json?.errors?.[0]?.message ?? `Enable workers_dev failed (${r.status})`;
      return { ok: false, error: msg };
    }
  }

  const url = subdomain ? `https://${serviceName}.${subdomain}.workers.dev/` : undefined;

  // 4) Quick health check (best‑effort; don’t block success forever)
  if (url) {
    const ok = await waitForHealth(url);
    if (!ok) {
      // Return ok=false so UI can surface a helpful message
      return { ok: false, error: "Deployed, but /api/health did not respond in time" };
    }
  }

  return { ok: true, name: serviceName, url };
}

async function waitForHealth(base: string): Promise<boolean> {
  const target = new URL("/api/health", base).toString();
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch(target as any, { cf: { cacheTtl: 0 } as any });
      if (r.ok) return true;
    } catch {
      // ignore and retry
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return false;
}

/** Short, URL-safe id for service names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}