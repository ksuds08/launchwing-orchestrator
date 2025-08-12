import type { Env } from "../types";
import { json } from "./log";

const CF_API = "https://api.cloudflare.com/client/v4";

export function cfHeaders(env: Env): HeadersInit {
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error("Missing env: CLOUDFLARE_API_TOKEN");
  return {
    Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json"
  };
}

export async function ensurePagesProject(env: Env, projectName: string) {
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing env: CLOUDFLARE_ACCOUNT_ID");
  const headers = cfHeaders(env);

  let res = await fetch(
    `${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}`,
    { headers }
  );
  if (res.status === 200) return (await res.json()).result;

  if (res.status !== 404) {
    json("ensurePagesProject unexpected", { status: res.status, body: await res.text() });
    throw new Error("Cloudflare API error");
  }

  // Create a Direct Upload project (GitHub deploy handled by workflow later)
  res = await fetch(`${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: projectName,
      production_branch: "main",
      build_config: { build_command: "", destination_dir: "dist" },
      deployment_configs: {
        production: { environment_variables: {} },
        preview: { environment_variables: {} }
      }
    })
  });

  if (!res.ok) throw new Error(`Failed to create Pages project: ${res.status} ${await res.text()}`);
  return (await res.json()).result;
}

export async function getPagesProject(env: Env, projectName: string) {
  if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Missing env: CLOUDFLARE_ACCOUNT_ID");
  const headers = cfHeaders(env);
  const res = await fetch(
    `${CF_API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}`,
    { headers }
  );
  return res.ok ? (await res.json()).result : null;
}