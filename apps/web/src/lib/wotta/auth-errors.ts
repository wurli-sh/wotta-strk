export type AuthProvider = "google" | "x";

export type OAuthCallbackFailure = {
  code: string;
  description: string;
};

const oauthCallbackKeys = ["error", "error_code", "error_description", "sb"] as const;

type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

function authErrorDetails(error: unknown): AuthErrorLike | undefined {
  return typeof error === "object" && error !== null ? error as AuthErrorLike : undefined;
}

export function normalizeIdentityLinkError(error: unknown, provider: AuthProvider): Error {
  const details = authErrorDetails(error);
  const code = typeof details?.code === "string" ? details.code : "";
  const message = typeof details?.message === "string" ? details.message : "";
  const status = typeof details?.status === "number" ? details.status : undefined;
  // Supabase returns 404 on /auth/v1/user/identities/authorize when manual
  // linking is off (often with a generic "Not Found" body).
  const manualLinkingDisabled = code === "manual_linking_disabled"
    || /manual(?: identity)? linking (?:is )?disabled/i.test(message)
    || status === 404
    || (typeof message === "string" && /link(?:ing)?|identit/i.test(message) && /not found|disabled/i.test(message));

  if (manualLinkingDisabled) {
    const providerLabel = provider === "x" ? "X" : "Google";
    return new Error(
      `Supabase manual identity linking is disabled. Enable Authentication → Providers (Google/X) and Authentication → Settings → Allow manual linking, then connect ${providerLabel} again.`,
    );
  }
  if (/unsupported provider|provider is not enabled/i.test(message)) {
    const providerLabel = provider === "x" ? "X" : "Google";
    return new Error(
      `${providerLabel} is not enabled in Supabase. Turn on Authentication → Providers → ${providerLabel === "X" ? "X / Twitter (OAuth 2.0)" : "Google"}, then try again.`,
    );
  }
  return error instanceof Error ? error : new Error(message || "Identity linking failed");
}

export function parseOAuthCallbackFailure(url: string): OAuthCallbackFailure | undefined {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
  const code = parsed.searchParams.get("error_code") ?? fragment.get("error_code")
    ?? parsed.searchParams.get("error") ?? fragment.get("error");
  if (!code) return undefined;
  return {
    code,
    description: parsed.searchParams.get("error_description") ?? fragment.get("error_description") ?? "OAuth linking failed",
  };
}

export function cleanOAuthCallbackUrl(url: string): string {
  const parsed = new URL(url);
  for (const key of oauthCallbackKeys) parsed.searchParams.delete(key);
  if (parsed.hash.startsWith("#")) {
    const fragment = new URLSearchParams(parsed.hash.slice(1));
    if (oauthCallbackKeys.some((key) => fragment.has(key))) {
      for (const key of oauthCallbackKeys) fragment.delete(key);
      parsed.hash = fragment.size ? `#${fragment.toString()}` : "";
    }
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function describeOAuthCallbackFailure(failure: OAuthCallbackFailure, provider?: AuthProvider): Error {
  const providerLabel = provider === "x" ? "X" : provider === "google" ? "Google" : "That sign-in";
  if (failure.code === "identity_already_exists") {
    return new Error(
      `${providerLabel} already belongs to another Supabase user. Wotta did not merge payment ownership. Use account recovery or remove the unused test account, then retry.`,
    );
  }
  return new Error(`${providerLabel} failed: ${failure.description} (${failure.code})`);
}
