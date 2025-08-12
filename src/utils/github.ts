import { json } from "./log";
import type { Env } from "../types";

const GH_API = "https://api.github.com";

export async function ensureRepo(env: Env, repo: string, isPrivate = true) {
  assertEnv(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  assertEnv(env.GITHUB_ORG, "GITHUB_ORG");

  const headers = ghHeaders(env.GITHUB_TOKEN!);

  // Try get
  let res = await fetch(`${GH_API}/repos/${env.GITHUB_ORG}/${repo}`, { headers });
  if (res.status === 200) return await res.json();

  // Create
  res = await fetch(`${GH_API}/orgs/${env.GITHUB_ORG}/repos`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: repo, private: isPrivate, auto_init: false })
  });
  if (!res.ok) throw new Error(`GitHub create repo failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export async function pushFilesWithContentsAPI(
  env: Env,
  repo: string,
  files: Record<string, string>,
  message: string
) {
  assertEnv(env.GITHUB_TOKEN, "GITHUB_TOKEN");
  assertEnv(env.GITHUB_ORG, "GITHUB_ORG");

  const headers = ghHeaders(env.GITHUB_TOKEN!);

  // For idempotency, fetch default branch latest SHA for root (optional)
  // Then PUT each file via contents API
  const entries = Object.entries(files);
  for (const [path, content] of entries) {
    const url = `${GH_API}/repos/${env.GITHUB_ORG}/${repo}/contents/${encodeURIComponent(path)}`;
    const get = await fetch(url, { headers });
    let sha: string | undefined;
    if (get.status === 200) {
      const j = await get.json();
      sha = j.sha;
    }

    const put = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message,
        content: b64(content),
        sha
      })
    });
    if (!put.ok) {
      const body = await put.text();
      json("GitHub PUT failed", { path, status: put.status, body });
      throw new Error(`GitHub push failed for ${path}: ${put.status}`);
    }
  }

  return `https://github.com/${env.GITHUB_ORG}/${repo}`;
}

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "LaunchWing-Orchestrator",
    Accept: "application/vnd.github+json"
  };
}
function b64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}
function assertEnv(v: unknown, name: string) {
  if (!v) throw new Error(`Missing env: ${name}`);
}