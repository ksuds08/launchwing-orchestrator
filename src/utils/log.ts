export function json(...args: unknown[]) {
  const ts = new Date().toISOString();
  const line = args
    .map((a) => {
      try {
        return typeof a === "string" ? a : JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
  console.log(`[${ts}] ${line}`);
}