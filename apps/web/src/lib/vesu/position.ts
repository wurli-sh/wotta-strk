import type { WalletAccountV6 } from "starknet";
import { readMainnetPrivateTokenBalance } from "@/lib/wotta/mainnet-privacy";
import { loadVesuEarn } from "./config";

export async function convertSharesToAssets(account: WalletAccountV6, shares: bigint): Promise<bigint> {
  if (shares < 0n) throw new Error("invalid_vesu_share_amount");
  const config = loadVesuEarn();
  const lowMask = (1n << 128n) - 1n;
  const values = await account.provider.callContract({
    contractAddress: config.vTokenAddress,
    entrypoint: "convert_to_assets",
    calldata: [`0x${(shares & lowMask).toString(16)}`, `0x${(shares >> 128n).toString(16)}`],
  }, "latest");
  return BigInt(values[0] ?? "0") + (BigInt(values[1] ?? "0") << 128n);
}

export async function readVesuPosition(account: WalletAccountV6): Promise<{ shares: bigint; assets: bigint }> {
  const shares = await readMainnetPrivateTokenBalance(account, loadVesuEarn().vTokenAddress);
  return { shares, assets: shares === 0n ? 0n : await convertSharesToAssets(account, shares) };
}

export function calculatePnl(currentAssets: bigint, costBasisAssets: bigint | null): { assets: bigint; basisPoints: bigint } | null {
  if (costBasisAssets === null || costBasisAssets <= 0n) return null;
  const assets = currentAssets - costBasisAssets;
  return { assets, basisPoints: (assets * 10_000n) / costBasisAssets };
}
