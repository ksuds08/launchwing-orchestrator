// src/utils/cloudflare.ts
import fs from "node:fs";
import path from "node:path";
import mime from "mime";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

function cfHeaders() {
  const email = process.env.CLOUDFLARE_EMAIL;
  const key = process.env.CLOUDFLARE_API_KEY;
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (email && key) {
    // Global API Key auth
    return {
      "X-Auth-Email": email,
      "X-Auth-Key": key
    };
  }
  if (token) {
    // Bearer API token auth
    return {
      Authorization: `Bearer ${token}`
    };
  }
  throw new Error("No Cloudflare API credentials found");
}

async function cfFetch(endpoint: string, opts: RequestInit = {}) {
  const headers = {
    ...cfHeaders(),
    "Content-Type": "application/json",
    ...opts.headers
  };
  const res = await fetch(`${CF_API_BASE}${endpoint}`, { ...opts, headers });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from Cloudflare: ${text}`);
  }
  if (!json.success) {
    const err = json.errors?.[0]?.message || JSON.stringify(json.errors || json);
    throw new Error(err);
  }
  return json.result;
}

export async function ensureService(accountId: string, serviceName: string) {
  try {
    await cfFetch(`/accounts/${accountId}/workers/services/${serviceName}`);
    return; // exists
  } catch {
    await cfFetch(`/accounts/${accountId}/workers/services/${serviceName}`, {
      method: "POST",
      body: JSON.stringify({ name: serviceName })
    });
  }
}

export async function uploadToService(
  accountId: string,
  serviceName: string,
  env: string,
  dir: string
) {
  const scriptPath = path.join(dir, "index.js");
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  const content = fs.readFileSync(scriptPath);

  const metadata = {
    main_module: "index.js"
  };

  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata), {
    contentType: "application/json"
  });
  form.append("index.js", new Blob([content]), {
    contentType: mime.getType("js") || "application/javascript"
  });

  const headers = cfHeaders(); // no JSON content-type here

  const res = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/services/${serviceName}/environments/${env}/script`,
    { method: "PUT", headers, body: form as any }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message || JSON.stringify(json.errors));
  }
  return json.result;
}

export async function enableWorkersDev(
  accountId: string,
  serviceName: string,
  env: string
) {
  await cfFetch(
    `/accounts/${accountId}/workers/services/${serviceName}/environments/${env}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({ workers_dev: true })
    }
  );
}