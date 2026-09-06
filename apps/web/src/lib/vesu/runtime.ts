import { num, type WalletAccountV6 } from "starknet";
import mainnetDeployment from "../../../../../deployments/mainnet.json" with { type: "json" };
import { hasLiveVesuAddresses, loadVesuEarn, sameFelt, type VesuEarnConfig } from "./config.ts";
import { ensureReadyChain } from "../wotta/ready.ts";

const PINNED_POOL_VERSION = "2.0";

export type PoolProtocolState = {
  version: string;
  classHash: string;
  feeAmount: bigint;
  proofValidityBlocks: number;
};

function feltToShortString(felt: string): string {
  const hex = num.toHex(felt).slice(2);
  const padded = hex.length % 2 ? `0${hex}` : hex;
  let out = "";
  for (let i = 0; i < padded.length; i += 2) {
    const code = Number.parseInt(padded.slice(i, i + 2), 16);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

export function assertFeltEq(
  left: string | null | undefined,
  right: string | null | undefined,
  label: string,
): void {
  if (!sameFelt(left, right)) throw new Error(`vesu_runtime_mismatch:${label}`);
}

async function callOne(
  account: WalletAccountV6,
  address: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string> {
  const values = await account.provider.callContract(
    { contractAddress: address, entrypoint, calldata },
    "latest",
  );
  if (values.length !== 1 || values[0] === undefined) {
    throw new Error("vesu_runtime_invalid_response");
  }
  return values[0];
}

/** Live STRK20 pool parameters used by Earn preflight (Limen readPoolState pattern). */
export async function readPoolProtocolState(
  account: WalletAccountV6,
  privacyPoolAddress: string,
): Promise<PoolProtocolState> {
  const [versionFelt, feeAmount, proofValidityBlocks, classHash] = await Promise.all([
    callOne(account, privacyPoolAddress, "get_version"),
    callOne(account, privacyPoolAddress, "get_fee_amount"),
    callOne(account, privacyPoolAddress, "get_proof_validity_blocks"),
    account.provider.getClassHashAt(privacyPoolAddress),
  ]);
  const proofValidity = BigInt(proofValidityBlocks);
  if (proofValidity <= 0n || proofValidity > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("vesu_runtime_mismatch:proof_validity_blocks");
  }
  return {
    version: feltToShortString(versionFelt),
    classHash: num.toHex(classHash),
    feeAmount: BigInt(feeAmount),
    proofValidityBlocks: Number(proofValidity),
  };
}

export async function isOpenNoteDepositorBlocked(
  account: WalletAccountV6,
  privacyPoolAddress: string,
  depositor: string,
): Promise<boolean> {
  const value = await callOne(account, privacyPoolAddress, "is_open_note_depositor_blocked", [
    depositor,
  ]);
  return BigInt(value) !== 0n;
}

function pinnedPrivacyFee(): bigint {
  return BigInt(mainnetDeployment.walletManagedPrivacy.protocolFeeStrk);
}

function pinnedPrivacyPoolClassHash(): string {
  return mainnetDeployment.walletManagedPrivacy.poolClassHash
    ?? mainnetDeployment.strk20ClassHash;
}

function encodeShortString(value: string): string {
  let hex = "";
  for (let i = 0; i < value.length; i += 1) {
    hex += value.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}

/**
 * Fail-fast drift check after Ready connection and before any Earn write.
 * TODO(vesu-smoke): add Ready deposit/redeem simulation once the anonymizer is live.
 */
export async function assertVesuRuntime(account: WalletAccountV6): Promise<void> {
  const config = loadVesuEarn();
  if (config.status === "pending") throw new Error("vesu_earn_pending");
  await ensureReadyChain(account, "mainnet");
  await assertVesuRuntimeWithConfig(account, config);
}

/** Testable core: assumes admission status already allows writes. */
export async function assertVesuRuntimeWithConfig(
  account: WalletAccountV6,
  config: VesuEarnConfig,
): Promise<void> {
  const anonymizerLive = hasLiveVesuAddresses(config);
  if (!anonymizerLive) throw new Error("vesu_manifest_mismatch:anonymizer_not_live");

  const [
    vesuPoolClass,
    factoryClass,
    vTokenClass,
    mappedVToken,
    asset,
    pool,
    vTokenDecimals,
    usdcDecimals,
    protocol,
  ] = await Promise.all([
    account.provider.getClassHashAt(config.poolAddress),
    account.provider.getClassHashAt(config.factoryAddress),
    account.provider.getClassHashAt(config.vTokenAddress),
    callOne(account, config.factoryAddress, "v_token_for_asset", [
      config.poolAddress,
      config.underlyingAddress,
    ]),
    callOne(account, config.vTokenAddress, "asset"),
    callOne(account, config.vTokenAddress, "pool_contract"),
    callOne(account, config.vTokenAddress, "decimals"),
    callOne(account, config.underlyingAddress, "decimals"),
    readPoolProtocolState(account, config.privacyPoolAddress),
  ]);

  assertFeltEq(vesuPoolClass, config.poolClassHash, "vesu_pool_class");
  assertFeltEq(factoryClass, config.factoryClassHash, "factory_class");
  assertFeltEq(vTokenClass, config.vTokenClassHash, "vtoken_class");
  assertFeltEq(mappedVToken, config.vTokenAddress, "factory_vtoken");
  assertFeltEq(asset, config.underlyingAddress, "vtoken_asset");
  assertFeltEq(pool, config.poolAddress, "vtoken_pool");
  if (BigInt(vTokenDecimals) !== BigInt(config.vTokenDecimals)) {
    throw new Error("vesu_runtime_mismatch:vtoken_decimals");
  }
  if (BigInt(usdcDecimals) !== BigInt(config.underlyingDecimals)) {
    throw new Error("vesu_runtime_mismatch:usdc_decimals");
  }

  assertFeltEq(protocol.classHash, pinnedPrivacyPoolClassHash(), "privacy_pool_class");
  if (protocol.version !== PINNED_POOL_VERSION) {
    throw new Error(`vesu_runtime_mismatch:privacy_pool_version:${protocol.version}`);
  }
  if (protocol.feeAmount !== pinnedPrivacyFee()) {
    throw new Error(`vesu_runtime_mismatch:privacy_pool_fee:${protocol.feeAmount}`);
  }
  if (!Number.isSafeInteger(protocol.proofValidityBlocks) || protocol.proofValidityBlocks <= 0) {
    throw new Error("vesu_runtime_mismatch:proof_validity_blocks");
  }

  const anonymizerClass = await account.provider.getClassHashAt(config.anonymizerAddress);
  assertFeltEq(anonymizerClass, config.anonymizerClassHash, "anonymizer_class");
  const blocked = await isOpenNoteDepositorBlocked(
    account,
    config.privacyPoolAddress,
    config.anonymizerAddress,
  );
  if (blocked) throw new Error("vesu_runtime_mismatch:anonymizer_open_note_blocked");
}

/** Exported for tests that need a felt encoding of the pinned pool version. */
export const VESU_RUNTIME_TEST = {
  PINNED_POOL_VERSION,
  encodeShortString,
  pinnedPrivacyFee,
  pinnedPrivacyPoolClassHash,
};
