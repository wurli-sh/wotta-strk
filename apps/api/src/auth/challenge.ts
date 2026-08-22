import { createHash, randomBytes } from "node:crypto";
import { hash as starknetHash, num, RpcProvider, type Signature, type TypedData, verifyMessageInStarknet } from "starknet";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";

const ttlMs = 5 * 60_000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const challengeHash = (value: TypedData) => sha256(JSON.stringify(value));
const feltHash = (value: string) => num.toHex(starknetHash.starknetKeccak(value));

export function walletBindingTypedData(input: {
  profileId: string;
  address: string;
  origin: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  chainId: string;
}): TypedData {
  return {
    domain: { name: "Wotta Wallet Binding", version: "1", chainId: input.chainId, revision: "1" },
    primaryType: "WottaWalletBinding",
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      // Ready currently signs this conservative SNIP-12 subset reliably. The
      // server stores and consumes the exact challenge, so hashing these long
      // strings does not weaken profile/origin binding.
      WottaWalletBinding: [
        { name: "profile_hash", type: "felt" },
        { name: "address", type: "felt" },
        { name: "origin_hash", type: "felt" },
        { name: "purpose", type: "shortstring" },
        { name: "nonce", type: "felt" },
        { name: "issued_at", type: "felt" },
        { name: "expires_at", type: "felt" },
      ],
    },
    message: {
      profile_hash: feltHash(input.profileId),
      address: input.address.toLowerCase(),
      origin_hash: feltHash(input.origin),
      purpose: "wallet_link",
      nonce: input.nonce,
      issued_at: Math.floor(input.issuedAt.getTime() / 1_000),
      expires_at: Math.floor(input.expiresAt.getTime() / 1_000),
    },
  };
}
export function requireWalletOrigin(config: Config, origin: string | undefined): string {
  const normalized = origin?.replace(/\/$/, "");
  if (!normalized || !config.corsOrigins.includes(normalized)) throw new Error("origin_invalid");
  return normalized;
}
export async function createWalletChallenge(db: Db, config: Config, profileId: string, address: string, origin: string) {
  const nonce = num.toHex(BigInt(`0x${randomBytes(31).toString("hex")}`)), issuedAt = new Date(), expiresAt = new Date(issuedAt.getTime() + ttlMs);
  const typedData = walletBindingTypedData({ profileId, address, origin, nonce, issuedAt, expiresAt, chainId: config.manifest.chainId });
  const { error } = await db.from("wallet_challenges").insert({ profile_id: profileId, nonce_hash: sha256(nonce), challenge_hash: challengeHash(typedData), address: address.toLowerCase(), purpose: "wallet_link", origin, expires_at: expiresAt.toISOString() });
  if (error) throw error; return { typedData, expiresAt: expiresAt.toISOString() };
}
export async function consumeWalletChallenge(db: Db, config: Config, profileId: string, challenge: TypedData, signature: Signature, inboxPublicKey: string, origin: string) {
  const message = challenge.message as { nonce?: string; address?: string; profile_hash?: string; origin_hash?: string; expires_at?: number };
  const nonce = message.nonce, address = message.address?.toLowerCase();
  if (!nonce || !address || message.profile_hash !== feltHash(profileId) || message.origin_hash !== feltHash(origin) || !message.expires_at || message.expires_at * 1000 < Date.now()) throw new Error("challenge_invalid");
  const provider = new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL });
  if (!(await verifyMessageInStarknet(provider, challenge, signature, address))) throw new Error("signature_invalid");
  const { data: row, error } = await db.from("wallet_challenges").update({ consumed_at: new Date().toISOString() }).eq("profile_id", profileId).eq("nonce_hash", sha256(nonce)).eq("challenge_hash", challengeHash(challenge)).eq("address", address).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
  if (error) throw error; if (!row) throw new Error("challenge_replayed_or_expired");

  const chainId = config.manifest.chainId;
  const { data: existingByAddress, error: addressLookupError } = await db
    .from("wallet_bindings")
    .select("id, profile_id, inbox_pubkey")
    .eq("chain_id", chainId)
    .eq("address", address)
    .is("revoked_at", null)
    .maybeSingle();
  if (addressLookupError) throw addressLookupError;

  if (existingByAddress?.profile_id === profileId) {
    if (existingByAddress.inbox_pubkey !== inboxPublicKey) throw new Error("wallet_inbox_key_mismatch");
    return { address, inboxPublicKey };
  }

  // Signature proves wallet ownership — reclaim address from a stale profile binding.
  if (existingByAddress) {
    const { error: revokeStaleError } = await db
      .from("wallet_bindings")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", existingByAddress.id);
    if (revokeStaleError) throw revokeStaleError;
  }

  const { error: revokeError } = await db.from("wallet_bindings").update({ revoked_at: new Date().toISOString() }).eq("profile_id", profileId).is("revoked_at", null); if (revokeError) throw revokeError;
  const { error: linkError } = await db.from("wallet_bindings").insert({ profile_id: profileId, address, chain_id: chainId, inbox_pubkey: inboxPublicKey, challenge_verified_at: new Date().toISOString() });
  if (linkError) {
    if (linkError.message.includes("wallet_bindings_active_address")) throw new Error("wallet_already_linked");
    throw linkError;
  }
  return { address, inboxPublicKey };
}
