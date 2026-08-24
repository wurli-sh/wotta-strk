import { SignJWT } from "jose";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { normalizeIdentifier } from "../auth/normalize.ts";
import { activeWalletBindingForProfile } from "../auth/wallet-bindings.ts";

type RecipientProvider = "email" | "google" | "x";

function lookupProviders(provider: RecipientProvider): RecipientProvider[] {
  return provider === "x" ? ["x"] : ["email", "google"];
}

export async function resolveDescriptor(db: Db, config: Config, provider: RecipientProvider, identifier: string) {
  const normalized = normalizeIdentifier(provider, identifier);
  const { data: identities, error } = await db.from("identities").select("profile_id").in("provider", lookupProviders(provider)).eq("normalized_identifier", normalized).is("revoked_at", null).not("verified_at", "is", null);
  if (error) throw error;
  const profileIds = [...new Set((identities ?? []).map((identity) => identity.profile_id))];
  if (profileIds.length > 1) throw new Error("identity_ambiguous");
  const identity = profileIds[0] ? { profile_id: profileIds[0] } : undefined;
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  let recipientStarknetAddress: string | undefined, recipientPrivateIdentityAddress: string | undefined, privacyPoolAddress: string | undefined, inboxEncryptionPublicKey: string | undefined;
  if (identity) {
    const expectedPool = config.manifest.walletManagedPrivacy?.status === "verified"
      ? config.manifest.walletManagedPrivacy.poolAddress
      : config.manifest.directPrivacy?.poolAddress;
    const wallet = await activeWalletBindingForProfile(db, identity.profile_id, config.manifest.chainId, { dedupe: true });
    recipientStarknetAddress = wallet?.address; inboxEncryptionPublicKey = wallet?.inbox_pubkey;
    if (wallet?.private_identity_verified_at && expectedPool && wallet.privacy_pool_address && BigInt(wallet.privacy_pool_address) === BigInt(expectedPool)) {
      recipientPrivateIdentityAddress = wallet.private_identity_address ?? undefined;
      privacyPoolAddress = wallet.privacy_pool_address ?? undefined;
    }
  }
  const descriptor = { version: 1, descriptorId: crypto.randomUUID(), registered: Boolean(identity && recipientStarknetAddress && inboxEncryptionPublicKey), privateReady: Boolean(recipientPrivateIdentityAddress && privacyPoolAddress), recipientProfileRef: identity?.profile_id, recipientStarknetAddress, recipientPrivateIdentityAddress, privacyPoolAddress, inboxEncryptionPublicKey, issuedAt: Math.floor(Date.now() / 1000), validUntil: expiresAt, nonce: crypto.randomUUID() };
  const signature = await new SignJWT(descriptor).setProtectedHeader({ alg: "HS256", typ: "wotta+descriptor" }).setIssuedAt().setExpirationTime(expiresAt).sign(new TextEncoder().encode(config.env.RESOLVER_SIGNING_KEY));
  return { descriptor, signature };
}
