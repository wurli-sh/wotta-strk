import type { Db } from "../db/client.ts";
import { normalizeIdentifier } from "./normalize.ts";

export type IdentityProvider = "email" | "google" | "x";

type SupabaseIdentity = {
  id?: string;
  provider?: string;
  identity_data?: Record<string, unknown>;
};

export type SupabaseAuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, unknown>;
  identities?: SupabaseIdentity[];
};

export type VerifiedIdentity = {
  provider: IdentityProvider;
  providerSubject: string;
  normalizedIdentifier: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identitySubject(identity: SupabaseIdentity): string | undefined {
  return stringValue(identity.identity_data?.provider_id)
    ?? stringValue(identity.identity_data?.sub)
    ?? stringValue(identity.id);
}

function verifiedEmail(user: SupabaseAuthUser, identity: SupabaseIdentity): string | undefined {
  const data = identity.identity_data ?? {};
  const email = stringValue(data.email) ?? stringValue(data.email_address);
  if (!email) return undefined;
  const providerVerified = data.email_verified === true || data.email_verified === "true" || data.email_verified === 1;
  const userVerified = Boolean(user.email_confirmed_at) && user.email?.toLowerCase() === email.toLowerCase();
  return providerVerified || userVerified ? normalizeIdentifier("email", email) : undefined;
}

/**
 * Derive only routable identities proven by Supabase OAuth metadata.
 * X contributes its handle and, when X supplied a verified email, an email
 * route. A linked Google address is never guessed to be X-owned.
 */
export function collectVerifiedIdentities(user: SupabaseAuthUser): VerifiedIdentity[] {
  const rows: VerifiedIdentity[] = [];
  const oauth = user.identities ?? [];
  const hasNonXIdentity = oauth.some((identity) => identity.provider === "google" || identity.provider === "email");

  for (const identity of oauth) {
    const subject = identitySubject(identity);
    if (!subject) continue;
    if (identity.provider === "google") {
      const email = verifiedEmail(user, identity);
      if (email) rows.push({ provider: "google", providerSubject: subject, normalizedIdentifier: email });
      continue;
    }
    if (identity.provider !== "x" && identity.provider !== "twitter") continue;

    const data = identity.identity_data ?? {};
    const handle = stringValue(data.preferred_username) ?? stringValue(data.user_name);
    if (handle) {
      rows.push({ provider: "x", providerSubject: subject, normalizedIdentifier: normalizeIdentifier("x", handle) });
    }

    let email = verifiedEmail(user, identity);
    if (!email && !hasNonXIdentity && user.email && user.email_confirmed_at) {
      email = normalizeIdentifier("email", user.email);
    }
    if (email) {
      rows.push({ provider: "email", providerSubject: `x-email:${subject}`, normalizedIdentifier: email });
    }
  }

  return rows.filter((row, index) => rows.findIndex((candidate) =>
    candidate.provider === row.provider && candidate.providerSubject === row.providerSubject) === index);
}

function ownershipProviders(provider: IdentityProvider): IdentityProvider[] {
  return provider === "x" ? ["x"] : ["email", "google"];
}

function identityAlreadyLinked(): Error & { code: string } {
  return Object.assign(new Error("identity_already_linked"), { code: "identity_already_linked" });
}

async function upsertVerifiedIdentity(db: Db, profileId: string, identity: VerifiedIdentity, verifiedAt: string): Promise<void> {
  const { data: bySubject, error: subjectError } = await db
    .from("identities")
    .select("id,profile_id,normalized_identifier")
    .eq("provider", identity.provider)
    .eq("provider_subject", identity.providerSubject)
    .maybeSingle();
  if (subjectError) throw subjectError;
  if (bySubject && bySubject.profile_id !== profileId) throw identityAlreadyLinked();

  const { data: byIdentifier, error: identifierError } = await db
    .from("identities")
    .select("id,profile_id")
    .in("provider", ownershipProviders(identity.provider))
    .eq("normalized_identifier", identity.normalizedIdentifier)
    .is("revoked_at", null);
  if (identifierError) throw identifierError;
  if ((byIdentifier ?? []).some((row) => row.profile_id !== profileId)) throw identityAlreadyLinked();

  if (bySubject) {
    const { error } = await db.from("identities").update({
      normalized_identifier: identity.normalizedIdentifier,
      verified_at: verifiedAt,
      revoked_at: null,
    }).eq("id", bySubject.id).eq("profile_id", profileId);
    if (error) throw error;
    return;
  }

  const { error } = await db.from("identities").insert({
    profile_id: profileId,
    provider: identity.provider,
    provider_subject: identity.providerSubject,
    normalized_identifier: identity.normalizedIdentifier,
    verified_at: verifiedAt,
    revoked_at: null,
  });
  if (error) {
    if (error.code === "23505") throw identityAlreadyLinked();
    throw error;
  }
}

/** Sync is ownership-preserving and reconciles Supabase unlink operations. */
export async function syncProfileIdentities(db: Db, token: string) {
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("unauthorized");
  const user = data.user as SupabaseAuthUser;
  const displayName = stringValue(user.user_metadata?.full_name) ?? null;
  const { error: profileError } = await db.from("profiles").upsert({ id: user.id, display_name: displayName });
  if (profileError) throw profileError;

  const desired = collectVerifiedIdentities(user);
  const verifiedAt = new Date().toISOString();
  for (const identity of desired) await upsertVerifiedIdentity(db, user.id, identity, verifiedAt);

  const { data: active, error: activeError } = await db
    .from("identities")
    .select("id,provider,provider_subject")
    .eq("profile_id", user.id)
    .is("revoked_at", null);
  if (activeError) throw activeError;
  const desiredKeys = new Set(desired.map((identity) => `${identity.provider}:${identity.providerSubject}`));
  const revokedIds = (active ?? [])
    .filter((identity) => !desiredKeys.has(`${identity.provider}:${identity.provider_subject}`))
    .map((identity) => identity.id);
  if (revokedIds.length) {
    const { error: revokeError } = await db.from("identities").update({ revoked_at: verifiedAt }).in("id", revokedIds).eq("profile_id", user.id);
    if (revokeError) throw revokeError;
  }

  return {
    profileId: user.id,
    synced: desired.map((identity) => ({ provider: identity.provider, identifier: identity.normalizedIdentifier })),
    revoked: revokedIds.length,
  };
}
