export interface Env {
  // Required
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;

  // Generators / routing
  AGENT_URL?: string; // https://launchwing-agent.onrender.com
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ORCHESTRATOR_URL?: string; // public URL; used by generated apps’ _worker.ts

  // Build metadata
  GIT_REF?: string;
  GIT_SHA?: string;
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type MvpRequest = {
  idea?: string;
  ideaId?: string;
  thread?: ChatMsg[];
  branding?: {
    name?: string;
    tagline?: string;
    palette?: { primary?: string };
  };
};

export type MvpResult = {
  ir: {
    name: string;
    app_type: "spa_api" | "spa" | "api";
    pages?: string[];
    api_routes?: Array<{ method: string; path: string }>;
    notes?: string;
  };
  files: Record<string, string>;
  smoke?: { passed: boolean; logs: string[] };
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };