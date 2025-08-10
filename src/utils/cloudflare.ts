// Cloudflare Workers deploy helpers — Scripts API upload + settings(workers_dev) + DEPLOYMENT(version_id) + health check (with version poll)

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

type CfResp = { ok: boolean; status: number; json: any; raw: string };

async function cf(token: string, url: string, init: RequestInit): Promise<CfResp> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const raw = await res.text();
  let json: any = {};
  try { json = JSON.parse(raw); } catch {}
  return { ok: res.ok, status: res.status, json, raw };
}

function errMsg(r: CfResp, fallback: string) {
  return (
    r.json?.errors?.[0]?.message ||
    r.json?.messages?.[0]?.message ||
    `${fallback} (${r.status}) :: ${r.raw.slice(0, 200)}`
  );
}

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
  {
    const metadata = { main_module: "index.js", compatibility_date: "2024-11-01" };
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
    fd.append("index.js", new Blob([code], { type: "application/javascript+module" }), "index.js");

    const r = await cf(token, base, { method: "PUT", body: fd });
    if (!r.ok) return { ok: false, error: errMsg(r, "Upload script failed"), status: r.status, endpoint: base };
  }

  // 2) Enable workers.dev (multipart with a part named **settings**)
  {
    const settingsUrl = `${base}/settings`;
    const form = new FormData();
    form.append(
      "settings",
      new Blob([JSON.stringify({ workers_dev: true })], { type: "application/json" }),
      "settings.json"
    );
    const r = await cf(token, settingsUrl, { method: "PATCH", body: form });
    if (!r.ok) return { ok: false, error: errMsg(r, "Enable workers_dev failed"), status: r.status, endpoint: settingsUrl };
  }

  // 3) Poll for latest version id (eventual consistency)
  const versionId = await waitForVersionId(token, base);
  if (!versionId) {
    return { ok: false, error: "Upload succeeded but could not resolve latest version_id after polling" };
  }

  // 4) Create deployment pointing at that version
  {
    const deployUrl = `${base}/deployments`;
    const body = { version_id: versionId };
    const r = await cf(token, deployUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: errMsg(r, "Create deployment failed"), status: r.status, endpoint: deployUrl };
  }

  const url = subdomain ? `https://${scriptName}.${subdomain}.workers.dev/` : undefined;

  // 5) Quick health check so we don’t return a dead URL
  if (url) {
    const healthy = await waitForHealth(url);
    if (!healthy) {
      return { ok: false, error: "Deployed, but /api/health did not respond in time", url, name: scriptName };
    }
  }

  return { ok: true, name: scriptName, url };
}

async function waitForVersionId(token: string, baseScriptUrl: string): Promise<string | undefined> {
  const versionsUrl = `${baseScriptUrl}/versions?per_page=1`;
  for (let i = 0; i < 12; i++) { // ~6s total
    const r = await cf(token, versionsUrl, { method: "GET" });
    if (r.ok) {
      // API may return either { result: [ {id,...} ] } or { result: { versions: [ {id,...} ] } }
      const arr = Array.isArray(r.json?.result)
        ? r.json.result
        : Array.isArray(r.json?.result?.versions)
          ? r.json.result.versions
          : [];
      const id = arr?.[0]?.id;
      if (id) return id;
    }
    await new Promise(res => setTimeout(res, 500));
  }
  return undefined;
}

async function waitForHealth(base: string): Promise<boolean> {
  const target = new URL("/api/health", base).toString();
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(target as any, { cf: { cacheTtl: 0 } as any });
      if (r.ok) return true;
    } catch { /* ignore and retry */ }
    await new Promise(res => setTimeout(res, 500));
  }
  return false;
}

/** Short, URL-safe id for script names */
export function shortId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0];
  return n.toString(36).slice(0, 8);
}