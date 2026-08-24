import { type STRK20_ACTION, type WalletAccountV6 } from "starknet";
import mainnetDeployment from "../../../../../deployments/mainnet.json";
import { ensureReadyChain } from "./ready.ts";

export const MAINNET_USDC_AMOUNT = 500_000n;
// Ready chooses and prices the private fee inside its confirmation UI; Wallet
// API 0.10.3 does not return that quote to the dapp. Keep a conservative USDC
// reserve inside the pool so an exact-denomination transfer can pay the fee.
export const MAINNET_USDC_PRIVACY_FEE_RESERVE = 250_000n;

export type MainnetPrivacyAction = "shield" | "transfer" | "withdraw";

export type MainnetPrivacyConfig = {
  chainId: "SN_MAIN";
  poolAddress: string;
  poolClassHash: string;
  usdc: string;
  feeToken: string;
  amount: bigint;
  allowedAmounts: readonly bigint[];
  protocolFeeStrk: bigint;
};

export function mainnetPrivacyConfig(): MainnetPrivacyConfig {
  const managed = mainnetDeployment.walletManagedPrivacy;
  if (managed.status !== "verified") throw new Error("mainnet_private_route_disabled");
  return {
    chainId: "SN_MAIN",
    poolAddress: managed.poolAddress,
    poolClassHash: managed.poolClassHash,
    usdc: managed.usdc,
    feeToken: managed.feeToken,
    amount: BigInt(managed.actionAmount),
    allowedAmounts: managed.allowedActionAmounts.map((amount) => BigInt(amount)),
    protocolFeeStrk: BigInt(managed.protocolFeeStrk),
  };
}

function feltAmount(amount: bigint): `0x${string}` {
  if (amount < 0n) throw new Error("invalid_private_amount");
  return `0x${amount.toString(16)}`;
}

export function mainnetActions(
  action: MainnetPrivacyAction,
  recipient?: string,
  amount = mainnetPrivacyConfig().amount,
): STRK20_ACTION[] {
  const config = mainnetPrivacyConfig();
  if (!config.allowedAmounts.includes(amount)) throw new Error("unsupported_mainnet_denomination");
  if (action === "shield") {
    return [{ type: "deposit", token: config.usdc, amount: feltAmount(amount) }];
  }
  if (!recipient || !/^0x[0-9a-f]+$/i.test(recipient)) {
    throw new Error("invalid_private_recipient");
  }
  return [{
    type: action === "transfer" ? "transfer" : "withdraw",
    token: config.usdc,
    amount: feltAmount(amount),
    recipient,
  }];
}

export function mainnetShieldedTransferActions(
  recipient: string,
  amount = mainnetPrivacyConfig().amount,
  shieldAmount = amount + MAINNET_USDC_PRIVACY_FEE_RESERVE,
): STRK20_ACTION[] {
  const config = mainnetPrivacyConfig();
  if (shieldAmount <= 0n) throw new Error("invalid_private_amount");
  return [
    { type: "deposit", token: config.usdc, amount: feltAmount(shieldAmount) },
    ...mainnetActions("transfer", recipient, amount),
  ];
}

function sameFelt(left: string, right: string): boolean {
  try { return BigInt(left) === BigInt(right); } catch { return false; }
}

function notRegistered(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes("NOT_REGISTERED");
}

function mainnetPrivacyRegistrationRequired(): Error {
  return new Error("mainnet_privacy_registration_required");
}

export async function assertMainnetPrivacyRuntime(account: WalletAccountV6): Promise<void> {
  const config = mainnetPrivacyConfig();
  await ensureReadyChain(account, "mainnet");
  const classHash = await account.provider.getClassHashAt(config.poolAddress);
  if (!sameFelt(classHash, config.poolClassHash)) throw new Error("mainnet_pool_class_mismatch");
}

export async function readMainnetPrivateBalance(account: WalletAccountV6): Promise<bigint> {
  const config = mainnetPrivacyConfig();
  let entries;
  try {
    entries = await account.strk20Balances([config.usdc]);
  } catch (error) {
    // The Wallet API has no dapp registration method. Until the user enables
    // Shielded tokens in Ready, an unregistered account has no private balance.
    if (notRegistered(error)) return 0n;
    throw error;
  }
  const entry = entries.find((item) => sameFelt(String(item.token), config.usdc));
  return entry ? BigInt(String(entry.balance)) : 0n;
}

export async function readMainnetPublicUsdcBalance(account: WalletAccountV6): Promise<bigint> {
  const config = mainnetPrivacyConfig();
  const values = await account.provider.callContract({
    contractAddress: config.usdc,
    entrypoint: "balance_of",
    calldata: [account.address],
  }, "latest");
  return BigInt(values[0] ?? "0") + (BigInt(values[1] ?? "0") << 128n);
}

export async function readMainnetPublicStrkBalance(account: WalletAccountV6): Promise<bigint> {
  const config = mainnetPrivacyConfig();
  const values = await account.provider.callContract({
    contractAddress: config.feeToken,
    entrypoint: "balance_of",
    calldata: [account.address],
  }, "latest");
  return BigInt(values[0] ?? "0") + (BigInt(values[1] ?? "0") << 128n);
}

async function submitMainnetPrivacyActions(
  account: WalletAccountV6,
  actions: STRK20_ACTION[],
  signal?: AbortSignal,
): Promise<string> {
  const config = mainnetPrivacyConfig();
  const startsWithShield = actions[0]?.type === "deposit";
  signal?.throwIfAborted();
  await assertMainnetPrivacyRuntime(account);
  signal?.throwIfAborted();
  try {
    const preview = await account.strk20PrepareInvoke(actions, true);
    if (!preview.call?.contract_address || !sameFelt(preview.call.contract_address, config.poolAddress)) {
      throw new Error("ready_pool_mismatch");
    }
    if (preview.proof.data !== "" || preview.proof.output.length || preview.proof.proof_facts.length) {
      throw new Error("invalid_private_simulation_preview");
    }
  } catch (error) {
    // A preview cannot be built before Ready has initialized its own private
    // state. Let the real action request surface the wallet's setup UI if it can.
    if (!startsWithShield || !notRegistered(error)) throw error;
  }
  signal?.throwIfAborted();
  let result;
  try {
    result = await account.strk20InvokeTransaction(actions);
  } catch (error) {
    // Wallet API 0.10.3 deliberately exposes no registration RPC. Registration
    // belongs to Ready, so Wotta must explain the wallet-side setup instead of
    // leaking the raw numeric NOT_REGISTERED wallet error.
    if (notRegistered(error)) throw mainnetPrivacyRegistrationRequired();
    throw error;
  }
  await account.provider.waitForTransaction(result.transaction_hash);
  signal?.throwIfAborted();
  return String(result.transaction_hash);
}

export async function submitMainnetPrivacyAction(
  account: WalletAccountV6,
  action: MainnetPrivacyAction,
  recipient?: string,
  signal?: AbortSignal,
  amount = mainnetPrivacyConfig().amount,
): Promise<string> {
  return submitMainnetPrivacyActions(
    account,
    mainnetActions(action, recipient, amount),
    signal,
  );
}

export async function submitMainnetShieldedTransfer(
  account: WalletAccountV6,
  recipient: string,
  signal?: AbortSignal,
  amount = mainnetPrivacyConfig().amount,
  shieldAmount = amount + MAINNET_USDC_PRIVACY_FEE_RESERVE,
): Promise<string> {
  return submitMainnetPrivacyActions(
    account,
    mainnetShieldedTransferActions(recipient, amount, shieldAmount),
    signal,
  );
}
