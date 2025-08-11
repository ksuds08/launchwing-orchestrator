// src/utils/cloudflare.ts
// Cloudflare Services API deploy (Worker-safe, with auth-mode log + diagnostics)

export interface DeployResult {
  ok: boolean;
  name?: string;
  url?: string;
  error?: string;
  status?: number;
  endpoint?: string;
  diagnostics?: any; // auth mode, settings snapshot, etc.
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
    return { "X-Auth-Email": env.CLOUDFLARE_EMAIL, "X-Auth-Key": env.CLOUDFLARE_API_KEY };
  }
  if (env.CLOUDFLARE_API_TOKEN) return { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  throw new Error(
    "Missing Cloudflare auth. Provide CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY or CLOUDFLARE_API_TOKEN."
  );
}

async function cf(env: EnvLike, url: string, init: RequestInit): Promise<CfResp> {
  const h = new Headers(init.headers || {});
  const a = authHeaders(env);
  for (const k of Object.keys(a)) h.set(k, a[k]);

  const res = await fetch(url, { ...init, headers: h });
  const raw = await res.text();
  let json: any = {};
  try { json = raw ? JSON.parse(raw) : {}; } catch {}
  return { ok: res.ok, status: res.status, json, raw };
}

function errMsg(r: CfResp, fallback: string) {
  return (
    r.json?.errors?.[0]?.message ||
    r.json?.messages?.[0]?.message ||
    `${fallback} (${r.status}) :: ${r.raw.slice(0, 200)}`
  );
}

function authMode(env: EnvLike) {
  return env.CLOUDFLARE_EMAIL && env.CLOUDFLARE_API_KEY ? "global-key"
       : env.CLOUDFLARE_API_TOKEN ? "api-token"
       : "none";
}

/**
 * Upload a single-file **module worker** to a Cloudflare **Service**,
 * enable workers.dev (multipart PATCH), verify setting, and wait for readiness.
 */
export async function uploadModuleWorker(
  serviceName: string,
  code: string,
  env: EnvLike
): Promise<DeployResult> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const subdomain = env.CF_WORKERS_SUBDOMAIN;
  if (!accountId) return { ok: false, error: "Missing CLOUDFLARE_ACCOUNT_ID" };

  // --- A) Auth mode log (helps confirm we’re not falling back to api-token) ---
  const _auth = authMode(env);
  console.log(`[cf-deploy] auth=${_auth} service=${serviceName}`);

  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/services/${encodeURIComponent(
    serviceName
  )}`;

  // 1) Ensure service exists (idempotent)
  {
    const r = await cf(env, base, { method: "PUT" });
    if (!r.ok && r.status !== 409) {
      return { ok: false, error: errMsg(r, "Create service failed"), status: r.status, endpoint: base, diagnostics: { auth: _auth } };
    }
  }

  // 2) Upload module code to production (multipart: metadata + index.js)
  {
    const metadata = { main_module: "index.js", compatibility_date: "2024-11-01" };
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

    const url = `${base}/environments/production/script`;
    const r = await cf(env, url, { method: "PUT", body: fd });
    if (!r.ok) {
      return { ok: false, error: errMsg(r, "Upload script failed"), status: r.status, endpoint: url, diagnostics: { auth: _auth } };
    }
  }

  // 3) Enable workers.dev (multipart settings) and verify it stuck
  {
    const url = `${base}/environments/production/settings`;
    const fd = new FormData();
    fd.append("settings", new Blob([JSON.stringify({ workers_dev: true })], { type: "application/json" }), "settings.json");

    const r = await cf(env, url, { method: "PATCH", body: fd });
    if (!r.ok) {
      return { ok: false, error: errMsg(r, "Enable workers_dev failed"), status: r.status, endpoint: url, diagnostics: { auth: _auth } };
    }

    // Verify current settings show workers_dev:true
    const verify = await cf(env, url, { method: "GET" });
    const enabled = !!verify.json?.result?.workers_dev || verify.json?.workers_dev === true;
    if (!verify.ok || !enabled) {
      return {
        ok: false,
        error: "workers.dev appears disabled after PATCH",
        status: verify.status,
        endpoint: url,
        diagnostics: { auth: _auth, settings: verify.json },
      };
    }
  }

  // 4) Compute workers.dev URL and poll readiness
  const url = subdomain ? `https://${serviceName}.${subdomain}.workers.dev/` : undefined;
  if (url) {
    const ready = await waitForReadiness(url);
    if (!ready) {
      // Snapshot settings to help debug “Inactive” cases
      const sUrl = `${base}/environments/production/settings`;
      const s = await cf(env, sUrl, { method: "GET" });
      return {
        ok: false,
        url,
        status: 200,
        error: "Deployed, workers.dev enabled, but not serving yet (propagation/edge delay). Try again shortly.",
        endpoint: url,
        diagnostics: { auth: _auth, settings: s.json?.result ?? s.json },
      };
    }
  }

  return { ok: true, name: serviceName, url, diagnostics: { auth: _auth } };
}

async function waitForReadiness(baseUrl: string): Promise<boolean> {
  const healthUrl = new URL("/api/health", baseUrl).toString();
  const placeholder = /There is nothing here yet/i;
  const okish = (s: number) => (s >= 200 && s < 300) || s === 302;

  // Up to ~3 minutes total
  for (let i = 0; i < 30; i++) {
    try {
      // 1) health (best-effort; may not exist in some generated apps)
      const h = await fetch(healthUrl as any, { cf: { cacheTtl: 0 } as any });
      if (okish(h.status)) return true;

      // 2) root — avoid the CF placeholder; consider non-HTML 2xx a good sign
      const r = await fetch(baseUrl as any, { cf: { cacheTtl: 0 } as any });
      if (okish(r.status)) {
        const ct = r.headers.get("content-type") || "";
        if (!ct.includes("text/html")) return true;
        const html = await r.text();
        if (!placeholder.test(html)) return true;
      }
    } catch {}
    await new Promise((res) => setTimeout(res, 6000));
  }
  return false;
}

/** Short, URL-safe id for service names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}