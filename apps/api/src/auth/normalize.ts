export function normalizeIdentifier(provider: "email" | "google" | "x", value: string): string {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (!normalized || normalized.length > 320) throw new Error("invalid_identifier");
  if ((provider === "email" || provider === "google") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("invalid_identifier");
  if (provider === "x" && !/^[a-z0-9_]{1,15}$/.test(normalized.replace(/^@/, ""))) throw new Error("invalid_identifier");
  return provider === "x" ? normalized.replace(/^@/, "") : normalized;
}
