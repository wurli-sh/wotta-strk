import type { Provider } from "@supabase/supabase-js";

export type WottaOAuthProvider = "google" | "x";

/**
 * Supabase product “X” uses provider id `x` (OAuth 2.0).
 * Older Twitter 1.0a used `twitter` — do not map X → twitter when
 * Authentication → Providers shows “X / Twitter (OAuth 2.0)”.
 */
export function toSupabaseProvider(provider: WottaOAuthProvider): Provider {
  return provider as Provider;
}
