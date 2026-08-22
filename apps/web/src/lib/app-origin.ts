/** Strip trailing slash from a configured origin URL. */
export function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

/** Cookie used to carry post-auth path without query params on redirectTo. */
export const AUTH_NEXT_COOKIE = "wotta_auth_next";

/**
 * Resolve the app origin for OAuth redirects.
 * In the browser, always use the current page origin so production never
 * inherits a localhost value baked in at build time.
 */
export function getAppOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  const fromEnv = process.env.NEXT_PUBLIC_APP_ORIGIN;
  if (fromEnv) return normalizeOrigin(fromEnv);
  return "http://localhost:3000";
}

/** Exact Supabase redirect URL (no query string — Supabase allow-list is exact). */
export function oauthCallbackUrl(): string {
  return `${getAppOrigin()}/auth/callback`;
}

export function stashAuthNext(next: string): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_NEXT_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=600; SameSite=Lax${secure}`;
}

/** Store desired post-auth path and return the exact OAuth callback URL. */
export function prepareOAuthRedirect(next: string): string {
  stashAuthNext(next);
  return oauthCallbackUrl();
}
