import { RpcProvider } from "starknet";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { activeWalletBindingForProfile } from "./wallet-bindings.ts";

const FELT = /^0x[0-9a-f]+$/i;

export async function bindPrivateIdentity(
  db: Db,
  config: Config,
  profileId: string,
  identityAddress: string,
) {
  if (!FELT.test(identityAddress)) throw new Error("invalid_private_identity_address");
  const direct = config.manifest.directPrivacy;
  const managed = config.manifest.walletManagedPrivacy;
  if ((!direct || direct.status !== "verified") && (!managed || managed.status !== "verified")) {
    throw new Error("private_route_disabled");
  }

  const wallet = await activeWalletBindingForProfile(db, profileId, config.manifest.chainId, { dedupe: true });
  if (!wallet) throw new Error("wallet_not_linked");

  const provider = new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL });

  if (config.manifest.chainId === "SN_MAIN") {
    if (!managed || managed.status !== "verified") throw new Error("private_route_disabled");
    if (BigInt(identityAddress) !== BigInt(wallet.address)) {
      throw new Error("private_identity_owner_mismatch");
    }
    let publicKey: string;
    try {
      publicKey = await provider.callContract({
        contractAddress: managed.poolAddress,
        entrypoint: "get_public_key",
        calldata: [wallet.address],
      }).then((result) => result[0] ?? "0x0");
    } catch {
      throw new Error("private_identity_verification_failed");
    }
    if (BigInt(publicKey) === 0n) throw new Error("private_identity_not_registered");

    const verifiedAt = new Date().toISOString();
    const { data, error: updateError } = await db
      .from("wallet_bindings")
      .update({
        private_identity_address: wallet.address.toLowerCase(),
        privacy_pool_address: managed.poolAddress.toLowerCase(),
        private_identity_verified_at: verifiedAt,
      })
      .eq("id", wallet.id)
      .is("revoked_at", null)
      .select("address,chain_id,private_identity_address,privacy_pool_address,private_identity_verified_at")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!data) throw new Error("wallet_not_linked");
    return data;
  }

  if (!direct || direct.status !== "verified") throw new Error("private_route_disabled");
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

  let classHash: string;
  try {
    classHash = await provider.getClassHashAt(identityAddress);
  } catch {
    throw new Error("private_identity_verification_failed");
  }
  if (BigInt(classHash) !== BigInt(direct.identityClassHash)) {
    throw new Error("private_identity_class_mismatch");
  }

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
    .maybeSingle();
  if (updateError) throw updateError;
  if (!data) throw new Error("wallet_not_linked");
  return data;
}
