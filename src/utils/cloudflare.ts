// src/utils/cloudflare.ts
// Cloudflare Services API deploy (Worker-safe)

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

function authHeaders(env: EnvLike): Record<string, string> {
  if (env.CLOUDFLARE_EMAIL && env.CLOUDFLARE_API_KEY) {
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
  // Merge headers, making sure auth wins and we DON'T force a content-type for multipart bodies.
  const h = new Headers(init.headers || {});
  const a = authHeaders(env);
  for (const k of Object.keys(a)) h.set(k, a[k]);

  const res = await fetch(url, { ...init, headers: h });
  const raw = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(raw);
  } catch {
    // some endpoints can return empty bodies; keep json as {}
  }
  return { ok: res.ok, status: res.status, json, raw };
}

function errMsg(r: CfResp, fallback: string) {
  return (
    r.json?.errors?.[0]?.message ||
    r.json?.messages?.[0]?.message ||
    `${fallback} (${r.status}) :: ${r.raw.slice(0, 200)}`
  );
}

/**
 * Upload a single-file **module worker** to a Cloudflare **Service**,
 * enable workers.dev (multipart PATCH), and wait for readiness.
 *
 * @param serviceName name of the service to create/update
 * @param code        ES module source for the main entry (index.js)
 * @param env         credentials + account/subdomain values
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
      return { ok: false, error: errMsg(r, "Create service failed"), status: r.status, endpoint: base };
    }
  }

  // 2) Upload module code to production (multipart: metadata + index.js)
  {
    const metadata = {
      main_module: "index.js",
      compatibility_date: "2024-11-01",
    };

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
    const r = await cf(env, url, { method: "PUT", body: fd }); // let FormData set content-type
    if (!r.ok) {
      return { ok: false, error: errMsg(r, "Upload script failed"), status: r.status, endpoint: url };
    }
  }

  // 3) Enable workers.dev (some accounts require multipart here)
  {
    const url = `${base}/environments/production/settings`;
    const fd = new FormData();
    fd.append(
      "settings",
      new Blob([JSON.stringify({ workers_dev: true })], { type: "application/json" }),
      "settings.json"
    );
    const r = await cf(env, url, { method: "PATCH", body: fd });
    if (!r.ok) {
      return { ok: false, error: errMsg(r, "Enable workers_dev failed"), status: r.status, endpoint: url };
    }
  }

  // Construct workers.dev URL if subdomain is known
  const url = subdomain ? `https://${serviceName}.${subdomain}.workers.dev/` : undefined;

  // 4) Readiness: poll /api/health and then root to dodge the placeholder page
  if (url) {
    const ready = await waitForReadiness(url);
    if (!ready) {
      return {
        ok: false,
        url,
        status: 200,
        error: "Deployed, workers.dev enabled, but not serving yet (propagation). Try again shortly.",
      };
    }
  }

  return { ok: true, name: serviceName, url };
}

async function waitForReadiness(baseUrl: string): Promise<boolean> {
  const healthUrl = new URL("/api/health", baseUrl).toString();
  const placeholder = /There is nothing here yet/i;

  for (let i = 0; i < 20; i++) {
    try {
      // check health
      const h = await fetch(healthUrl as any, { cf: { cacheTtl: 0 } as any });
      if (h.ok) return true;

      // check root (avoid placeholder)
      const r = await fetch(baseUrl as any, { cf: { cacheTtl: 0 } as any });
      if (r.ok) {
        const html = await r.text();
        if (!placeholder.test(html)) return true;
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