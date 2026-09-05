import type { STRK20_ACTION } from "starknet";
import { hasLiveVesuAddresses, loadVesuEarn, sameFelt, type VesuEarnConfig } from "./config";

const U128 = 1n << 128n;

export function splitU256(value: bigint): [`0x${string}`, `0x${string}`] {
  if (value < 0n || value >= (1n << 256n)) throw new Error("invalid_u256");
  return [`0x${(value % U128).toString(16)}`, `0x${(value / U128).toString(16)}`];
}

function assertPinned(config: VesuEarnConfig): void {
  const pinned = loadVesuEarn();
  if (!hasLiveVesuAddresses(config)
    || !sameFelt(config.poolAddress, pinned.poolAddress)
    || !sameFelt(config.underlyingAddress, pinned.underlyingAddress)
    || !sameFelt(config.vTokenAddress, pinned.vTokenAddress)
    || !sameFelt(config.anonymizerAddress, pinned.anonymizerAddress)
    || !sameFelt(config.privacyPoolAddress, pinned.privacyPoolAddress)) {
    throw new Error("vesu_manifest_mismatch");
  }
}

export function buildVesuDepositActions(
  readyAddress: string,
  assets: bigint,
  config = loadVesuEarn(),
): STRK20_ACTION[] {
  assertPinned(config);
  return vesuDepositActions(readyAddress, assets, config);
}

export function vesuDepositActions(
  readyAddress: string,
  assets: bigint,
  config: VesuEarnConfig,
): STRK20_ACTION[] {
  if (!hasLiveVesuAddresses(config)) throw new Error("vesu_manifest_mismatch");
  if (!config.allowedDepositAmounts.includes(assets) || assets <= 0n) throw new Error("unsupported_vesu_deposit_amount");
  if (!/^0x[0-9a-f]+$/i.test(readyAddress)) throw new Error("invalid_private_recipient");
  const [low, high] = splitU256(assets);
  const amount = `0x${assets.toString(16)}` as const;
  return [
    { type: "withdraw", token: config.underlyingAddress, amount, recipient: config.anonymizerAddress },
    { type: "transfer", token: config.vTokenAddress, amount: "OPEN", recipient: readyAddress },
    { type: "invoke", contract: config.anonymizerAddress, calldata: ["0x0", config.underlyingAddress, config.vTokenAddress, low, high, "${openNoteIds[0]}"] },
  ];
}

export function buildVesuRedeemActions(
  readyAddress: string,
  shares: bigint,
  privateShareBalance: bigint,
  config = loadVesuEarn(),
): STRK20_ACTION[] {
  assertPinned(config);
  return vesuRedeemActions(readyAddress, shares, privateShareBalance, config);
}

export function vesuRedeemActions(
  readyAddress: string,
  shares: bigint,
  privateShareBalance: bigint,
  config: VesuEarnConfig,
): STRK20_ACTION[] {
  if (!hasLiveVesuAddresses(config)) throw new Error("vesu_manifest_mismatch");
  if (shares <= 0n || shares > privateShareBalance) throw new Error("invalid_vesu_share_amount");
  if (!/^0x[0-9a-f]+$/i.test(readyAddress)) throw new Error("invalid_private_recipient");
  const [low, high] = splitU256(shares);
  const amount = `0x${shares.toString(16)}` as const;
  return [
    { type: "withdraw", token: config.vTokenAddress, amount, recipient: config.anonymizerAddress },
    { type: "transfer", token: config.underlyingAddress, amount: "OPEN", recipient: readyAddress },
    { type: "invoke", contract: config.anonymizerAddress, calldata: ["0x1", config.vTokenAddress, config.underlyingAddress, low, high, "${openNoteIds[0]}"] },
  ];
}
