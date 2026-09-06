import { hash, num, type RpcProvider } from "starknet";
import { sameFelt, type VesuEarnConfig } from "./config.ts";

/** Reconstruct Vesu Earn from chain evidence; never trust the submitting UI. */
export type VesuEarnOperation = "deposit" | "redeem";

export type VesuEarnReceiptLike = {
  execution_status?: string;
  finality_status?: string;
  block_number?: number;
  events?: Array<{ from_address: string; keys: string[]; data: string[] }>;
};

export type VesuEarnVerifyExpected = {
  operation: VesuEarnOperation;
  expectedInAmount: bigint;
  config: Pick<
    VesuEarnConfig,
    "privacyPoolAddress" | "anonymizerAddress" | "underlyingAddress" | "vTokenAddress"
  >;
};

export type VesuEarnVerification = {
  transactionHash: string | null;
  status: "verified" | "failed";
  blockNumber: number | null;
  ok: boolean;
  checks: {
    succeeded: boolean;
    finalized: boolean;
    poolTouched: boolean;
    anonymizerInvoked: boolean;
    invokeSelector: "privacy_invoke" | "privacy_invoke_with_computation" | null;
    privacyInvokeOnly: boolean;
    withdrawalToAnonymizer: boolean;
    withdrawalTokenMatches: boolean;
    privateSourced: boolean;
    vesuActionObserved: boolean;
    vesuActorsMatch: boolean;
    vesuInputMatches: boolean;
    vesuOutputMatches: boolean;
    openNoteCredited: boolean;
    openNoteTokenMatches: boolean;
    openNoteAmountNonZero: boolean;
    openNoteIdNonZero: boolean;
    anonymizerBalancesCleared: boolean | null;
  };
  observed: {
    inToken: string;
    outToken: string;
    withdrawnFromPool: string | null;
    vesuInput: string | null;
    vesuOutput: string | null;
    creditedToOpenNote: string | null;
    publiclyToppedUp: string | null;
  };
  problems: string[];
};

type EventLike = { from_address: string; keys: string[]; data: string[] };

const SELECTORS = {
  withdrawal: num.toHex(hash.getSelectorFromName("Withdrawal")),
  openNoteDeposited: num.toHex(hash.getSelectorFromName("OpenNoteDeposited")),
  externalContractInvoked: num.toHex(hash.getSelectorFromName("ExternalContractInvoked")),
  privacyInvoke: num.toHex(hash.getSelectorFromName("privacy_invoke")),
  privacyInvokeWithComputation: num.toHex(hash.getSelectorFromName("privacy_invoke_with_computation")),
  vesuDeposit: num.toHex(hash.getSelectorFromName("Deposit")),
  vesuWithdraw: num.toHex(hash.getSelectorFromName("Withdraw")),
};

function matching(events: EventLike[], from: string, selector: string): EventLike[] {
  return events.filter((event) => sameFelt(event.from_address, from) && sameFelt(event.keys[0], selector));
}

function felt(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function u256(data: string[], offset: number): bigint | null {
  const low = felt(data[offset]);
  const high = felt(data[offset + 1]);
  if (low === null || high === null || low < 0n || high < 0n || low >= 1n << 128n || high >= 1n << 128n) {
    return null;
  }
  return low + (high << 128n);
}

function unique(events: EventLike[], description: string, problems: string[]): EventLike | null {
  if (events.length !== 1) {
    problems.push(`expected exactly one ${description}; observed ${events.length}`);
    return null;
  }
  return events[0] ?? null;
}

function expectedTokens(expected: VesuEarnVerifyExpected): { inToken: string; outToken: string } {
  return expected.operation === "deposit"
    ? { inToken: expected.config.underlyingAddress, outToken: expected.config.vTokenAddress }
    : { inToken: expected.config.vTokenAddress, outToken: expected.config.underlyingAddress };
}

/** Pure, offline-friendly verification over a receipt or committed fixture. */
export function verifyVesuEarnReceipt(
  receipt: VesuEarnReceiptLike,
  expected: VesuEarnVerifyExpected,
  transactionHash: string | null = null,
): VesuEarnVerification {
  const events = receipt.events ?? [];
  const problems: string[] = [];
  const { inToken, outToken } = expectedTokens(expected);
  const { privacyPoolAddress: pool, anonymizerAddress: anonymizer, vTokenAddress } = expected.config;

  if (expected.expectedInAmount <= 0n) problems.push("expected input amount must be positive");
  const succeeded = receipt.execution_status === "SUCCEEDED";
  if (!succeeded) problems.push(`execution_status is ${receipt.execution_status ?? "unknown"}`);
  const finalized = receipt.finality_status === "ACCEPTED_ON_L2"
    || receipt.finality_status === "ACCEPTED_ON_L1";
  if (!finalized) problems.push(`finality_status is ${receipt.finality_status ?? "unknown"}`);

  const poolTouched = events.some((event) => sameFelt(event.from_address, pool));
  if (!poolTouched) problems.push("no event from the STRK20 privacy pool");

  const invoke = unique(
    matching(events, pool, SELECTORS.externalContractInvoked),
    "pool ExternalContractInvoked event",
    problems,
  );
  const invokeSelectorKey = invoke?.keys[2];
  const invokeSelector: VesuEarnVerification["checks"]["invokeSelector"] = invokeSelectorKey && sameFelt(invokeSelectorKey, SELECTORS.privacyInvoke)
    ? "privacy_invoke"
    : invokeSelectorKey && sameFelt(invokeSelectorKey, SELECTORS.privacyInvokeWithComputation)
      ? "privacy_invoke_with_computation"
      : null;
  const anonymizerInvoked = invoke !== null && sameFelt(invoke.keys[1], anonymizer);
  if (invoke && !anonymizerInvoked) problems.push("the pool invoked an address other than the pinned anonymizer");
  const privacyInvokeOnly = invokeSelector === "privacy_invoke";
  if (invoke && !privacyInvokeOnly) problems.push(`expected privacy_invoke but observed ${invokeSelector ?? "unknown selector"}`);

  // Ready may emit extra pool Withdrawals in the same invoke (e.g. private
  // fee/gas notes). Only the earn path's Withdrawal to the anonymizer counts.
  const withdrawal = unique(
    matching(events, pool, SELECTORS.withdrawal).filter(
      (event) => sameFelt(event.keys[1], anonymizer) && sameFelt(event.keys[2], inToken),
    ),
    "pool Withdrawal event to the anonymizer",
    problems,
  );
  const withdrawnToken = withdrawal?.keys[2];
  const withdrawnAmount = felt(withdrawal?.data[3]);
  const withdrawalToAnonymizer = withdrawal !== null && sameFelt(withdrawal.keys[1], anonymizer);
  if (withdrawal && !withdrawalToAnonymizer) problems.push("pool Withdrawal recipient is not the pinned anonymizer");
  const withdrawalTokenMatches = withdrawal !== null && sameFelt(withdrawnToken, inToken);
  if (withdrawal && !withdrawalTokenMatches) problems.push("withdrawal token does not match the expected input token");
  if (withdrawal && withdrawnAmount === null) problems.push("withdrawal amount is missing or malformed");
  const privateSourced = withdrawnAmount === expected.expectedInAmount;
  if (withdrawnAmount !== null && !privateSourced) problems.push(`Withdrawal.amount ${withdrawnAmount} != expected ${expected.expectedInAmount}`);

  const vesuSelector = expected.operation === "deposit" ? SELECTORS.vesuDeposit : SELECTORS.vesuWithdraw;
  const vesuEvent = unique(matching(events, vTokenAddress, vesuSelector), `Vesu ${expected.operation} event`, problems);
  const requiredActors = expected.operation === "deposit" ? [1, 2] : [1, 2, 3];
  const vesuActorsMatch = vesuEvent !== null && requiredActors.every((index) => sameFelt(vesuEvent.keys[index], anonymizer));
  if (vesuEvent && !vesuActorsMatch) problems.push(`Vesu ${expected.operation} actors are not the pinned anonymizer`);
  const assets = vesuEvent ? u256(vesuEvent.data, 0) : null;
  const shares = vesuEvent ? u256(vesuEvent.data, 2) : null;
  if (vesuEvent && (assets === null || shares === null)) problems.push(`Vesu ${expected.operation} amounts are missing or malformed`);
  const vesuInput = expected.operation === "deposit" ? assets : shares;
  const vesuOutput = expected.operation === "deposit" ? shares : assets;
  const vesuInputMatches = vesuInput === expected.expectedInAmount;
  if (vesuEvent && vesuInput !== null && !vesuInputMatches) problems.push(`Vesu input ${vesuInput} != expected ${expected.expectedInAmount}`);

  const openNote = unique(
    matching(events, pool, SELECTORS.openNoteDeposited),
    "pool OpenNoteDeposited event",
    problems,
  );
  const creditedAmount = felt(openNote?.data[0]);
  const openNoteCredited = openNote !== null;
  if (openNote && !sameFelt(openNote.keys[1], anonymizer)) problems.push("open-note depositor is not the pinned anonymizer");
  const openNoteTokenMatches = openNote !== null && sameFelt(openNote.keys[2], outToken);
  if (openNote && !openNoteTokenMatches) problems.push("open-note token does not match the expected output token");
  const openNoteAmountNonZero = creditedAmount !== null && creditedAmount > 0n;
  if (openNote && !openNoteAmountNonZero) problems.push("open-note credit amount is missing, malformed, or zero");
  const noteId = felt(openNote?.keys[3]);
  const openNoteIdNonZero = noteId !== null && noteId > 0n;
  if (openNote && !openNoteIdNonZero) problems.push("open-note id is missing, malformed, or zero");
  const vesuOutputMatches = vesuOutput !== null && creditedAmount !== null && vesuOutput === creditedAmount;
  if (vesuEvent && openNote && !vesuOutputMatches) problems.push("Vesu output does not equal the private open-note credit");

  const checks = {
    succeeded,
    finalized,
    poolTouched,
    anonymizerInvoked,
    invokeSelector,
    privacyInvokeOnly,
    withdrawalToAnonymizer,
    withdrawalTokenMatches,
    privateSourced,
    vesuActionObserved: vesuEvent !== null,
    vesuActorsMatch,
    vesuInputMatches,
    vesuOutputMatches,
    openNoteCredited,
    openNoteTokenMatches,
    openNoteAmountNonZero,
    openNoteIdNonZero,
    anonymizerBalancesCleared: null,
  };
  const ok = problems.length === 0;
  return {
    transactionHash,
    status: ok ? "verified" : "failed",
    blockNumber: receipt.block_number ?? null,
    ok,
    checks,
    observed: {
      inToken,
      outToken,
      withdrawnFromPool: withdrawnAmount?.toString() ?? null,
      vesuInput: vesuInput?.toString() ?? null,
      vesuOutput: vesuOutput?.toString() ?? null,
      creditedToOpenNote: creditedAmount?.toString() ?? null,
      publiclyToppedUp: withdrawnAmount === null ? null : (expected.expectedInAmount - withdrawnAmount).toString(),
    },
    problems,
  };
}

type ReceiptProvider = Pick<RpcProvider, "getTransactionReceipt" | "callContract">;

export async function verifyVesuEarnTransaction(
  provider: ReceiptProvider,
  transactionHash: string,
  expected: VesuEarnVerifyExpected,
): Promise<VesuEarnVerification> {
  const receipt = await provider.getTransactionReceipt(transactionHash) as unknown as VesuEarnReceiptLike;
  const result = verifyVesuEarnReceipt(receipt, expected, transactionHash);
  if (!result.ok) return result;
  if (result.blockNumber === null) {
    result.problems.push("successful receipt has no block number for residue verification");
  } else {
    try {
      await assertAnonymizerBalancesCleared(provider, expected.config, result.blockNumber);
      result.checks.anonymizerBalancesCleared = true;
    } catch (error) {
      result.checks.anonymizerBalancesCleared = false;
      result.problems.push(error instanceof Error ? error.message : "anonymizer balance check failed");
    }
  }
  result.ok = result.problems.length === 0;
  result.status = result.ok ? "verified" : "failed";
  return result;
}

/** Check residue at the transaction block so later transfers cannot hide stranded funds. */
export async function assertAnonymizerBalancesCleared(
  provider: Pick<RpcProvider, "callContract">,
  config: Pick<VesuEarnConfig, "anonymizerAddress" | "underlyingAddress" | "vTokenAddress">,
  block: number | string = "latest",
): Promise<void> {
  for (const token of [config.underlyingAddress, config.vTokenAddress]) {
    const values = await provider.callContract(
      { contractAddress: token, entrypoint: "balance_of", calldata: [config.anonymizerAddress] },
      block,
    );
    if (values.length !== 2) throw new Error(`vesu_anonymizer_balance_malformed:${token}`);
    const balance = u256(values, 0);
    if (balance === null) throw new Error(`vesu_anonymizer_balance_malformed:${token}`);
    if (balance !== 0n) throw new Error(`vesu_anonymizer_balance_stranded:${token}:${balance}`);
  }
}

export const VESU_EARN_EVENT_SELECTORS = SELECTORS;
