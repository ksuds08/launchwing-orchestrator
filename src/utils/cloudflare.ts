// src/utils/cloudflare.ts
// Worker-safe Cloudflare deploy helpers — Services API + workers_dev enable + readiness poll

export interface DeployResult {
  ok: boolean;
  name?: string;
  url?: string;
  error?: string;
  status?: number;
  endpoint?: string;
}

interface EnvLike {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKERS_SUBDOMAIN?: string;
  CLOUDFLARE_EMAIL?: string;
  CLOUDFLARE_API_KEY?: string;
}

type CfResp = { ok: boolean; status: number; json: any; raw: string };

function buildAuthHeaders(env: EnvLike): Record<string, string> {
  if (env.CLOUDFLARE_EMAIL && env.CLOUDFLARE_API_KEY) {
    // Prefer Global API Key (most reliable across accounts)
    return {
      "X-Auth-Email": env.CLOUDFLARE_EMAIL,
      "X-Auth-Key": env.CLOUDFLARE_API_KEY,
    };
  }
  if (env.CLOUDFLARE_API_TOKEN) {
    return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  }
  throw new Error(
    "Missing Cloudflare auth. Provide CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY or CLOUDFLARE_API_TOKEN."
  );
}

async function cf(env: EnvLike, url: string, init: RequestInit): Promise<CfResp> {
  const headers: Record<string, string> = {
    ...buildAuthHeaders(env),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(url, { ...init, headers });
  const raw = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(raw);
  } catch {
    // leave json as {}
  }
  return { ok: res.ok, status: res.status, json, raw };
}

function msg(r: CfResp, fallback: string) {
  return (
    r.json?.errors?.[0]?.message ||
    r.json?.messages?.[0]?.message ||
    `${fallback} (${r.status}) :: ${r.raw.slice(0, 200)}`
  );
}

/**
 * Upload a single-file **Module Worker** via the Services API, enable workers.dev,
 * and wait until the URL serves (health/root).
 *
 * @param serviceName  the Worker service name to create/update
 * @param code         ES module source for the worker's main module (string)
 * @param env          environment vars (secrets)
 */
export async function uploadModuleWorker(
  serviceName: string,
  code: string,
  env: EnvLike
): Promise<DeployResult> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const subdomain = env.CF_WORKERS_SUBDOMAIN;

  if (!accountId) return { ok: false, error: "Missing CLOUDFLARE_ACCOUNT_ID" };

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${encodeURIComponent(
    serviceName
  )}`;

  // 1) Ensure service exists (idempotent)
  {
    const r = await cf(env, base, { method: "PUT" });
    if (!r.ok && r.status !== 409) {
      return { ok: false, error: msg(r, "Create service failed"), status: r.status, endpoint: base };
    }
  }

  // 2) Upload module code to production (multipart: metadata + index.js)
  {
    const metadata = { main_module: "index.js", compatibility_date: "2024-11-01" };

    const fd = new FormData();
    fd.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" }),
      "metadata.json"
    );
    fd.append(
      "index.js",
      new Blob([code], { type: "application/javascript+module" }),
      "index.js"
    );

    const url = `${base}/environments/production/script`;
    const r = await cf(env, url, { method: "PUT", body: fd });
    if (!r.ok) {
      return { ok: false, error: msg(r, "Upload script failed"), status: r.status, endpoint: url };
    }
  }

  // 3) Enable workers.dev on production (JSON body)
  {
    const url = `${base}/environments/production/settings`;
    const r = await cf(env, url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workers_dev: true }),
    });
    if (!r.ok) {
      return { ok: false, error: msg(r, "Enable workers_dev failed"), status: r.status, endpoint: url };
    }
  }

  const url = subdomain ? `https://${serviceName}.${subdomain}.workers.dev/` : undefined;

  // 4) Readiness: poll /api/health then root (avoid CF placeholder)
  if (url) {
    const ready = await waitForReadiness(url);
    if (!ready) {
      // Return the URL anyway; likely propagation; caller can retry
      return {
        ok: false,
        error: "Deployed, workers.dev enabled, but not serving yet (propagation). Try again shortly.",
        url,
        status: 200,
      };
    }
  }

  return { ok: true, name: serviceName, url };
}

async function waitForReadiness(base: string): Promise<boolean> {
  const healthUrl = new URL("/api/health", base).toString();
  const isPlaceholder = (html: string) =>
    /There is nothing here yet/i.test(html) ||
    (/workers\.dev/i.test(html) && /nothing here/i.test(html));

  for (let i = 0; i < 20; i++) {
    try {
      const h = await fetch(healthUrl as any, { cf: { cacheTtl: 0 } as any });
      if (h.ok) return true;

      const r = await fetch(base as any, { cf: { cacheTtl: 0 } as any });
      if (r.ok) {
        const html = await r.text();
        if (!isPlaceholder(html)) return true;
      }
    } catch {
      // ignore and retry
    }
    await new Promise((res) => setTimeout(res, 3000)); // 3s backoff
  }
  return false;
}

/** Short, URL-safe id for service names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}