import type { WalletAccountV6 } from "starknet";
import { loadVesuEarn, sameFelt } from "./config";

async function callOne(account: WalletAccountV6, address: string, entrypoint: string, calldata: string[] = []): Promise<string> {
  const values = await account.provider.callContract({ contractAddress: address, entrypoint, calldata }, "latest");
  if (values.length !== 1 || values[0] === undefined) throw new Error("vesu_runtime_invalid_response");
  return values[0];
}

/** Fail-fast drift check run after Ready connection and before any Earn write. */
export async function assertVesuRuntime(account: WalletAccountV6): Promise<void> {
  const config = loadVesuEarn();
  if (config.status === "pending") throw new Error("vesu_earn_pending");
  const [poolClass, factoryClass, vTokenClass, anonymizerClass, mappedVToken, asset, pool, decimals] = await Promise.all([
    account.provider.getClassHashAt(config.poolAddress),
    account.provider.getClassHashAt(config.factoryAddress),
    account.provider.getClassHashAt(config.vTokenAddress),
    account.provider.getClassHashAt(config.anonymizerAddress),
    callOne(account, config.factoryAddress, "v_token_for_asset", [config.poolAddress, config.underlyingAddress]),
    callOne(account, config.vTokenAddress, "asset"),
    callOne(account, config.vTokenAddress, "pool_contract"),
    callOne(account, config.vTokenAddress, "decimals"),
  ]);
  if (!sameFelt(poolClass, config.poolClassHash)
    || !sameFelt(factoryClass, config.factoryClassHash)
    || !sameFelt(vTokenClass, config.vTokenClassHash)
    || !sameFelt(anonymizerClass, config.anonymizerClassHash)
    || !sameFelt(mappedVToken, config.vTokenAddress)
    || !sameFelt(asset, config.underlyingAddress)
    || !sameFelt(pool, config.poolAddress)
    || BigInt(decimals) !== BigInt(config.vTokenDecimals)) {
    throw new Error("vesu_runtime_mismatch");
  }
}
