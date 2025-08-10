// Cloudflare API helpers (stubbed for now)
export interface DeployResult { ok: boolean; url?: string }
export async function deploySandbox(_bundle: ArrayBuffer): Promise<DeployResult> {
  return { ok: true }; // Implement with Workers API later
}