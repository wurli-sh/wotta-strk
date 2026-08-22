import { RpcProvider } from "starknet";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";

const FELT = /^0x[0-9a-f]+$/i;

export async function bindPrivateIdentity(
  db: Db,
  config: Config,
  profileId: string,
  identityAddress: string,
) {
  if (!FELT.test(identityAddress)) throw new Error("invalid_private_identity_address");
  const direct = config.manifest.directPrivacy;
  if (!direct || direct.status !== "verified") throw new Error("private_route_disabled");

  const { data: wallet, error } = await db
    .from("wallet_bindings")
    .select("id,address")
    .eq("profile_id", profileId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!wallet) throw new Error("wallet_not_linked");

  const provider = new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL });
  let owner: string;
  let publicKey: string;
  try {
    [owner, publicKey] = await Promise.all([
      provider.callContract({ contractAddress: identityAddress, entrypoint: "owner", calldata: [] }).then((result) => result[0] ?? "0x0"),
      provider.callContract({ contractAddress: direct.poolAddress, entrypoint: "get_public_key", calldata: [identityAddress] }).then((result) => result[0] ?? "0x0"),
    ]);
  } catch {
    throw new Error("private_identity_verification_failed");
  }
  if (BigInt(owner) !== BigInt(wallet.address)) throw new Error("private_identity_owner_mismatch");
  if (BigInt(publicKey) === 0n) throw new Error("private_identity_not_registered");

  const verifiedAt = new Date().toISOString();
  const { data, error: updateError } = await db
    .from("wallet_bindings")
    .update({
      private_identity_address: identityAddress.toLowerCase(),
      privacy_pool_address: direct.poolAddress.toLowerCase(),
      private_identity_verified_at: verifiedAt,
    })
    .eq("id", wallet.id)
    .is("revoked_at", null)
    .select("address,chain_id,private_identity_address,privacy_pool_address,private_identity_verified_at")
    .single();
  if (updateError) throw updateError;
  return data;
}
