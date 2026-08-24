import type { Db } from "../db/client.ts";
import { normalizeWalletAddress, sameWalletAddress } from "./challenge.ts";

export type ActiveWalletBinding = {
  id: string;
  profile_id: string;
  address: string;
  chain_id: string;
  inbox_pubkey: string;
  key_version?: number;
  private_identity_address?: string | null;
  privacy_pool_address?: string | null;
  private_identity_verified_at?: string | null;
  created_at?: string;
};

export async function listActiveWalletBindingsForProfile(
  db: Db,
  profileId: string,
  chainId: string,
): Promise<ActiveWalletBinding[]> {
  const { data, error } = await db
    .from("wallet_bindings")
    .select("id, profile_id, address, chain_id, inbox_pubkey, key_version, private_identity_address, privacy_pool_address, private_identity_verified_at, created_at")
    .eq("profile_id", profileId)
    .eq("chain_id", chainId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Return one active binding; optionally revoke duplicate rows left from pre-migration data. */
export async function activeWalletBindingForProfile(
  db: Db,
  profileId: string,
  chainId: string,
  options: { dedupe?: boolean } = {},
): Promise<ActiveWalletBinding | null> {
  const rows = await listActiveWalletBindingsForProfile(db, profileId, chainId);
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!;
  if (!options.dedupe) throw new Error("wallet_binding_ambiguous");

  const [keep, ...dupes] = rows;
  const revokedAt = new Date().toISOString();
  for (const dupe of dupes) {
    const { error } = await db
      .from("wallet_bindings")
      .update({ revoked_at: revokedAt })
      .eq("id", dupe.id);
    if (error) throw error;
  }
  return keep!;
}

export async function findActiveWalletBindingByAddress(
  db: Db,
  chainId: string,
  address: string,
): Promise<ActiveWalletBinding | null> {
  const normalized = normalizeWalletAddress(address);
  const { data, error } = await db
    .from("wallet_bindings")
    .select("id, profile_id, address, chain_id, inbox_pubkey, key_version, private_identity_address, privacy_pool_address, private_identity_verified_at, created_at")
    .eq("chain_id", chainId)
    .is("revoked_at", null);
  if (error) throw error;
  return (data ?? []).find((candidate) => sameWalletAddress(candidate.address, normalized)) ?? null;
}
