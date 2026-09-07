import type { STRK20_ACTION } from "starknet";
import { hasLiveVesuAddresses, loadVesuEarn, sameFelt, type VesuEarnConfig } from "./config";
import { toWalletApiFelt } from "@/lib/wotta/wallet-api";

const U128 = 1n << 128n;

/**
 * Wallet API 0.10.3 FELT encoding:
 * `^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$`
 *
 * Leading-zero padded addresses fail Ready's invoke-calldata schema and surface
 * as INVALID_REQUEST_PAYLOAD. Token fields on withdraw/transfer stay in the
 * manifest/padded form Ready used when indexing private notes — rewriting those
 * to canonical felts can make Ready report INSUFFICIENT_PRIVATE_BALANCE even
 * when Wotta's balance read (felt-equal) still shows funds.
 */
export function splitU256(value: bigint): [`0x${string}`, `0x${string}`] {
  if (value < 0n || value >= (1n << 256n)) throw new Error("invalid_u256");
  return [toWalletApiFelt(value % U128), toWalletApiFelt(value / U128)];
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
  const amount = toWalletApiFelt(assets);
  const anonymizer = toWalletApiFelt(config.anonymizerAddress);
  return [
    {
      type: "withdraw",
      token: config.underlyingAddress,
      amount,
      recipient: anonymizer,
    },
    {
      type: "transfer",
      token: config.vTokenAddress,
      amount: "OPEN",
      recipient: toWalletApiFelt(readyAddress),
    },
    {
      type: "invoke",
      contract: anonymizer,
      calldata: [
        "0x0",
        toWalletApiFelt(config.underlyingAddress),
        toWalletApiFelt(config.vTokenAddress),
        low,
        high,
        "${openNoteIds[0]}",
      ],
    },
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
  const amount = toWalletApiFelt(shares);
  const anonymizer = toWalletApiFelt(config.anonymizerAddress);
  return [
    {
      type: "withdraw",
      token: config.vTokenAddress,
      amount,
      recipient: anonymizer,
    },
    {
      type: "transfer",
      token: config.underlyingAddress,
      amount: "OPEN",
      recipient: toWalletApiFelt(readyAddress),
    },
    {
      type: "invoke",
      contract: anonymizer,
      calldata: [
        "0x1",
        toWalletApiFelt(config.vTokenAddress),
        toWalletApiFelt(config.underlyingAddress),
        low,
        high,
        "${openNoteIds[0]}",
      ],
    },
  ];
}
