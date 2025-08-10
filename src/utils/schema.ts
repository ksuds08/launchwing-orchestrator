import type { IR } from "@t/ir";

export function validateIR(ir: IR): { valid: true } | { valid: false; error: string } {
  // TODO: implement JSON Schema check; accept stub for now
  if (!ir || !ir.app_type || !ir.name) return { valid: false, error: "invalid IR" };
  return { valid: true };
}