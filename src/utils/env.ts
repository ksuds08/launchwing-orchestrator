// Helpers for reading/validating environment bindings can go here.
export const notEmpty = (v: string | undefined, name: string): string => {
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
};