// File helpers for artifact assembly (no Node 'fs' in Workers runtime)
export type FileMap = Record<string, string>;

/** Join path segments using forward slashes (safe for Workers) */
export function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

/** Basic in-memory “zip” placeholder: return a JSON string for now */
export async function toZipLikeJson(files: FileMap): Promise<string> {
  return JSON.stringify(files);
}