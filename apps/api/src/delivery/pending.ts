import { createHmac } from "node:crypto";
import nacl from "tweetnacl";
import type { Db } from "../db/client.ts";
import type { Config } from "../config.ts";
import { normalizeIdentifier } from "../auth/normalize.ts";
import { activeWalletBindingForProfile } from "../auth/wallet-bindings.ts";

type RecipientProvider = "email" | "google" | "x";
const lookupNamespace = (provider: RecipientProvider) => provider === "x" ? "x" : "email";
const lookupProviders = (provider: RecipientProvider): RecipientProvider[] => provider === "x" ? ["x"] : ["email", "google"];
export function lookupHash(config: Config, provider: RecipientProvider, identifier: string) { return createHmac("sha256", config.env.IDENTITY_LOOKUP_KEY).update(`${lookupNamespace(provider)}:${normalizeIdentifier(provider, identifier)}`).digest("hex"); }
function legacyLookupHash(config: Config, provider: "google", identifier: string) { return createHmac("sha256", config.env.IDENTITY_LOOKUP_KEY).update(`${provider}:${normalizeIdentifier(provider, identifier)}`).digest("hex"); }
const decode = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));
const encode = (value: Uint8Array) => Buffer.from(value).toString("base64url");
export function pendingDeliveryPublicKey(config: Config): string {
  return encode(nacl.box.keyPair.fromSecretKey(decode(config.env.PENDING_DELIVERY_PRIVATE_KEY)).publicKey);
}
export async function storeDelivery(db: Db, config: Config, params: { senderId: string; intentId: string; recipient: { provider: RecipientProvider; identifier: string }; ciphertext: string; nonce: string; ephemeralPublicKey: string; algorithm: "x25519-xsalsa20-poly1305"; expiresAt: string }) {
  const normalized = normalizeIdentifier(params.recipient.provider, params.recipient.identifier);
  const { data: identities, error: identityError } = await db.from("identities").select("profile_id").in("provider", lookupProviders(params.recipient.provider)).eq("normalized_identifier", normalized).is("revoked_at", null).not("verified_at", "is", null); if (identityError) throw identityError;
  const profileIds = [...new Set((identities ?? []).map((candidate) => candidate.profile_id))];
  if (profileIds.length > 1) throw new Error("identity_ambiguous");
  const identity = profileIds[0] ? { profile_id: profileIds[0] } : undefined;
  if (identity) {
    const wallet = await activeWalletBindingForProfile(db, identity.profile_id, config.manifest.chainId, { dedupe: true });
    if (!wallet) throw new Error("recipient_wallet_unbound");
    const { error } = await db.from("encrypted_notes").upsert({ recipient_profile_id: identity.profile_id, sender_profile_id: params.senderId, intent_id: params.intentId, ciphertext: params.ciphertext, nonce: params.nonce, sender_public_key: params.ephemeralPublicKey, algorithm: params.algorithm }, { onConflict: "recipient_profile_id,intent_id" }); if (error) throw error;
    return "registered" as const;
  }
  const { error } = await db.from("pending_claims").upsert({ sender_profile_id: params.senderId, recipient_lookup_hash: lookupHash(config, params.recipient.provider, params.recipient.identifier), intent_id: params.intentId, sealed_payload: JSON.stringify({ ciphertext: params.ciphertext, nonce: params.nonce, ephemeralPublicKey: params.ephemeralPublicKey, algorithm: params.algorithm }), key_version: 1, expires_at: params.expiresAt }, { onConflict: "intent_id" }); if (error) throw error;
  return "pending" as const;
}
/** Service-only worker: decrypts Wotta-pending ciphertext and re-encrypts it to the newly bound inbox key. */
export async function deliverPendingForProfile(db: Db, config: Config, profileId: string, identities: { provider: string; identifier: string }[]) {
  const supported = identities.filter((id): id is { provider: RecipientProvider; identifier: string } => id.provider === "email" || id.provider === "google" || id.provider === "x");
  const hashes = [...new Set(supported.flatMap((id) => {
    const current = lookupHash(config, id.provider, id.identifier);
    return id.provider === "google" ? [current, legacyLookupHash(config, "google", id.identifier)] : [current];
  }))];
  const wallet = await activeWalletBindingForProfile(db, profileId, config.manifest.chainId, { dedupe: true });
  if (!wallet) return 0;
  const token = crypto.randomUUID(); const { data, error } = await db.rpc("claim_pending_claims", { p_profile_id: profileId, p_lookup_hashes: hashes, p_token: token }); if (error) throw error;
  const serverKeys = nacl.box.keyPair.fromSecretKey(decode(config.env.PENDING_DELIVERY_PRIVATE_KEY)); let delivered = 0;
  for (const row of (data ?? []) as { id: string; intent_id: string; sender_profile_id: string; sealed_payload: string }[]) {
    const payload = JSON.parse(row.sealed_payload) as { ciphertext: string; nonce: string; ephemeralPublicKey: string; algorithm: "x25519-xsalsa20-poly1305" };
    const plaintext = nacl.box.open(decode(payload.ciphertext), decode(payload.nonce), decode(payload.ephemeralPublicKey), serverKeys.secretKey); if (!plaintext) throw new Error("pending_decrypt_failed");
    const nonce = nacl.randomBytes(nacl.box.nonceLength), ciphertext = nacl.box(plaintext, nonce, decode(wallet.inbox_pubkey), serverKeys.secretKey);
    const { error: noteError } = await db.from("encrypted_notes").upsert({ recipient_profile_id: profileId, sender_profile_id: row.sender_profile_id, intent_id: row.intent_id, ciphertext: encode(ciphertext), nonce: encode(nonce), sender_public_key: encode(serverKeys.publicKey), algorithm: payload.algorithm }, { onConflict: "recipient_profile_id,intent_id" }); if (noteError) throw noteError;
    const { error: finishError } = await db.from("pending_claims").update({ delivered_profile_id: profileId, delivered_at: new Date().toISOString(), purge_after: new Date(Date.now() + 86_400_000).toISOString(), processing_token: null, processing_expires_at: null }).eq("id", row.id).eq("processing_token", token).is("delivered_at", null); if (finishError) throw finishError; delivered++;
  }
  return delivered;
}
