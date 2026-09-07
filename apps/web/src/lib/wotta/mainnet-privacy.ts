import { type STRK20_ACTION, type WalletAccountV6 } from "starknet";
import mainnetDeployment from "../../../../../deployments/mainnet.json" with { type: "json" };
import { clearReadyConnections, ensureReadyChain } from "./ready.ts";
import { toWalletApiFelt } from "./wallet-api.ts";

export const MAINNET_USDC_AMOUNT = 100_000n;
const READY_BALANCE_TIMEOUT_MS = 30_000;
// Ready chooses and prices the private fee inside its confirmation UI; Wallet
// API 0.10.3 does not return that quote to the dapp. Keep a conservative USDC
// reserve inside the pool so an exact-denomination transfer can pay the fee.
export const MAINNET_USDC_PRIVACY_FEE_RESERVE = 250_000n;

type Strk20SubmitRuntime = {
  version: number;
  inFlight: { key: string; promise: Promise<string> } | null;
  completed: Map<string, { transactionHash: string; completedAt: number }>;
  traceSequence: number;
};

declare global {
  var __wottaStrk20SubmitRuntime: Strk20SubmitRuntime | undefined;
}

const STRK20_SUBMIT_RUNTIME_VERSION = 3;
const STRK20_REPLAY_WINDOW_MS = 30_000;

function strk20SubmitRuntime(): Strk20SubmitRuntime {
  const existing = globalThis.__wottaStrk20SubmitRuntime;
  if (existing?.version === STRK20_SUBMIT_RUNTIME_VERSION) return existing;
  return (globalThis.__wottaStrk20SubmitRuntime = {
    version: STRK20_SUBMIT_RUNTIME_VERSION,
    inFlight: null,
    completed: new Map(),
    traceSequence: 0,
  });
}

/** Stable fingerprint so a double-clicked Yield shares one Ready prompt. */
export function fingerprintStrk20Actions(actions: STRK20_ACTION[]): string {
  return JSON.stringify(actions);
}

/** Test helper — clears tab-scoped STRK20 submit coalescing state. */
export function resetStrk20SubmitForTests(): void {
  globalThis.__wottaStrk20SubmitRuntime = {
    version: STRK20_SUBMIT_RUNTIME_VERSION,
    inFlight: null,
    completed: new Map(),
    traceSequence: 0,
  };
}

type Strk20TraceEvent =
  | "submit_enter"
  | "dedup_completed"
  | "dedup_in_flight"
  | "wallet_request"
  | "wallet_resolved"
  | "receipt_success"
  | "wallet_rejected";

function traceStrk20Submit(
  event: Strk20TraceEvent,
  requestId: string,
  actions: STRK20_ACTION[],
  transactionHash?: string,
): void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return;
  const detail = {
    event,
    requestId,
    actionTypes: actions.map((action) => action.type),
    ...(transactionHash ? { transactionHash } : {}),
  };
  // Keep a browser copy even if the development trace route is unavailable.
  console.info("[wotta:strk20]", detail);
  void fetch("/api/strk20-trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(detail),
    keepalive: true,
  }).catch(() => undefined);
}

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
    recipient: toWalletApiFelt(recipient),
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

export function mainnetEscrowClaimActions(input: {
  recipient: string;
  escrow: { address: string; classHash: string; denomination: bigint };
  claimSecret: string;
}): STRK20_ACTION[] {
  const config = mainnetPrivacyConfig();
  if (!mainnetDeployment.verified) throw new Error("mainnet_escrow_manifest_not_verified");
  const pool = mainnetDeployment.pools.find((candidate) =>
    candidate.verification.status === "verified"
    && BigInt(candidate.address) === BigInt(input.escrow.address)
    && BigInt(candidate.classHash) === BigInt(input.escrow.classHash)
    && BigInt(candidate.denomination) === input.escrow.denomination);
  if (!pool || !(mainnetDeployment.approvedCctpDenominations as string[]).includes(pool.denomination)) {
    throw new Error("mainnet_escrow_not_verified");
  }
  if (!/^0x[0-9a-f]+$/i.test(input.recipient) || !/^0x[0-9a-f]+$/i.test(input.claimSecret) || BigInt(input.claimSecret) === 0n) {
    throw new Error("invalid_mainnet_escrow_claim");
  }
  return buildEscrowClaimActions(config.usdc, input.recipient, pool.address, input.claimSecret);
}

/** Deterministic Wallet API encoding; admission is enforced by mainnetEscrowClaimActions. */
export function buildEscrowClaimActions(
  usdc: string,
  recipient: string,
  escrow: string,
  claimSecret: string,
): STRK20_ACTION[] {
  const walletRecipient = toWalletApiFelt(recipient);
  return [
    { type: "transfer", token: usdc, amount: "OPEN", recipient: walletRecipient },
    {
      type: "invoke",
      contract: toWalletApiFelt(escrow),
      calldata: [
        "0x2",
        "0x0",
        "0x0",
        "0x0",
        "0x0",
        toWalletApiFelt(claimSecret),
        "${openNoteIds[0]}",
        "0x0",
      ],
    },
  ];
}

function sameFelt(left: string, right: string): boolean {
  try { return BigInt(left) === BigInt(right); } catch { return false; }
}

function notRegistered(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes("NOT_REGISTERED");
}

function balanceReadTimedOut(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes(
    "balance_check_unresponsive",
  );
}

function mainnetPrivacyRegistrationRequired(): Error {
  return new Error("mainnet_privacy_registration_required");
}

async function withBalanceReadTimeout<T>(request: Promise<T>, timeoutMs = READY_BALANCE_TIMEOUT_MS): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("balance_check_unresponsive")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function assertMainnetPrivacyRuntime(account: WalletAccountV6): Promise<void> {
  const config = mainnetPrivacyConfig();
  await ensureReadyChain(account, "mainnet");
  const classHash = await account.provider.getClassHashAt(config.poolAddress);
  if (!sameFelt(classHash, config.poolClassHash)) throw new Error("mainnet_pool_class_mismatch");
}

export async function readMainnetPrivateBalance(
  account: WalletAccountV6,
  options?: { timeoutMs?: number },
): Promise<bigint> {
  return readMainnetPrivateTokenBalance(account, mainnetPrivacyConfig().usdc, options);
}

export async function readMainnetPrivateTokenBalance(
  account: WalletAccountV6,
  token: string,
  options?: { timeoutMs?: number },
): Promise<bigint> {
  if (!/^0x[0-9a-f]+$/i.test(token)) throw new Error("invalid_private_token");
  let entries;
  try {
    entries = await withBalanceReadTimeout(
      account.strk20Balances([token]),
      options?.timeoutMs ?? READY_BALANCE_TIMEOUT_MS,
    );
  } catch (error) {
    // A hanging balance request usually means Ready reloaded while Wotta still
    // held the old wallet provider. Drop that provider so the next Reveal makes
    // a fresh Wallet API connection instead of retrying the dead session.
    if (balanceReadTimedOut(error)) clearReadyConnections();
    // The Wallet API has no dapp registration method. Until the user enables
    // Shielded tokens in Ready, an unregistered account has no private balance.
    if (notRegistered(error)) return 0n;
    throw error;
  }
  const entry = entries.find((item) => sameFelt(String(item.token), token));
  return entry ? BigInt(String(entry.balance)) : 0n;
}

export async function readMainnetPublicUsdcBalance(account: WalletAccountV6): Promise<bigint> {
  const config = mainnetPrivacyConfig();
  const values = await withBalanceReadTimeout(account.provider.callContract({
    contractAddress: config.usdc,
    entrypoint: "balance_of",
    calldata: [account.address],
  }, "latest"));
  return BigInt(values[0] ?? "0") + (BigInt(values[1] ?? "0") << 128n);
}

export async function readMainnetPublicStrkBalance(account: WalletAccountV6): Promise<bigint> {
  const config = mainnetPrivacyConfig();
  const values = await withBalanceReadTimeout(account.provider.callContract({
    contractAddress: config.feeToken,
    entrypoint: "balance_of",
    calldata: [account.address],
  }, "latest"));
  return BigInt(values[0] ?? "0") + (BigInt(values[1] ?? "0") << 128n);
}

export async function submitMainnetStrk20Actions(
  account: WalletAccountV6,
  actions: STRK20_ACTION[],
  signal?: AbortSignal,
  onSubmitted?: (transactionHash: string) => void,
): Promise<string> {
  signal?.throwIfAborted();
  const runtime = strk20SubmitRuntime();
  const requestId = `req-${Date.now().toString(36)}-${++runtime.traceSequence}`;
  traceStrk20Submit("submit_enter", requestId, actions);
  const accountKey = typeof account.address === "string"
    ? account.address.toLowerCase()
    : "unknown-account";
  const key = `${accountKey}:${fingerprintStrk20Actions(actions)}`;
  const now = Date.now();
  for (const [completedKey, completed] of runtime.completed) {
    if (now - completed.completedAt >= STRK20_REPLAY_WINDOW_MS) {
      runtime.completed.delete(completedKey);
    }
  }
  // React/event replays can arrive just after the original promise settles.
  // Keep a short receipt-backed idempotency window so the same action cannot be
  // broadcast again after it already succeeded and spent its private note.
  const completed = runtime.completed.get(key);
  if (completed) {
    traceStrk20Submit("dedup_completed", requestId, actions, completed.transactionHash);
    return completed.transactionHash;
  }
  // Coalesce duplicate in-flight invokes (double click / remount). A second
  // wallet_strk20InvokeTransaction call opens another Ready confirmation and
  // can deposit twice for one Yield press.
  if (runtime.inFlight) {
    if (runtime.inFlight.key === key) {
      traceStrk20Submit("dedup_in_flight", requestId, actions);
      return runtime.inFlight.promise;
    }
    throw new Error("private_submit_in_flight");
  }

  const promise = (async () => {
    await assertMainnetPrivacyRuntime(account);
    signal?.throwIfAborted();
    // Do not call strk20PrepareInvoke before invoke: Ready currently shows a
    // second, identical approval UI for simulate=true prepare, which caused
    // duplicate pops and false INSUFFICIENT_PRIVATE_BALANCE on the spare prompt.
    // Pool targeting stays enforced by assertMainnetPrivacyRuntime above.
    let result;
    try {
      traceStrk20Submit("wallet_request", requestId, actions);
      result = await account.strk20InvokeTransaction(actions);
      traceStrk20Submit(
        "wallet_resolved",
        requestId,
        actions,
        String(result.transaction_hash),
      );
    } catch (error) {
      traceStrk20Submit("wallet_rejected", requestId, actions);
      // Wallet API 0.10.3 deliberately exposes no registration RPC. Registration
      // belongs to Ready, so Wotta must explain the wallet-side setup instead of
      // leaking the raw numeric NOT_REGISTERED wallet error.
      if (notRegistered(error)) throw mainnetPrivacyRegistrationRequired();
      throw error;
    }
    onSubmitted?.(String(result.transaction_hash));
    const receipt = await account.provider.waitForTransaction(result.transaction_hash);
    if (!receipt.isSuccess()) throw new Error("Mainnet private transaction reverted");
    signal?.throwIfAborted();
    const transactionHash = String(result.transaction_hash);
    traceStrk20Submit("receipt_success", requestId, actions, transactionHash);
    runtime.completed.set(key, {
      transactionHash,
      completedAt: Date.now(),
    });
    return transactionHash;
  })();

  runtime.inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (runtime.inFlight?.promise === promise) runtime.inFlight = null;
  }
}

const submitMainnetPrivacyActions = submitMainnetStrk20Actions;

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

export async function submitMainnetEscrowClaim(
  account: WalletAccountV6,
  input: { escrow: { address: string; classHash: string; denomination: bigint }; claimSecret: string },
  signal?: AbortSignal,
  onSubmitted?: (transactionHash: string) => void,
): Promise<string> {
  return submitMainnetPrivacyActions(
    account,
    mainnetEscrowClaimActions({ ...input, recipient: account.address }),
    signal,
    onSubmitted,
  );
}
