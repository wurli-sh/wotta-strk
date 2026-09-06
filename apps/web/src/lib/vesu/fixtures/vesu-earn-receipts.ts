import { hash, num } from "starknet";
import type { VesuEarnReceiptLike, VesuEarnVerifyExpected } from "../verify-receipt";
import { VESU_EARN_EVENT_SELECTORS as SELECTORS } from "../verify-receipt";

/** Fixture anonymizer — not deployed; used only for synthetic receipt tests. */
export const FIXTURE_ANONYMIZER = "0x111111111111111111111111111111111111111111111111111111111111111";

export type FixtureAddresses = {
  privacyPoolAddress: string;
  anonymizerAddress: string;
  underlyingAddress: string;
  vTokenAddress: string;
};

export function fixtureExpected(
  addresses: FixtureAddresses,
  operation: "deposit" | "redeem",
  expectedInAmount: bigint,
): VesuEarnVerifyExpected {
  return {
    operation,
    expectedInAmount,
    config: addresses,
  };
}

function felt(value: string | bigint): string {
  return typeof value === "bigint" ? num.toHex(value) : num.toHex(BigInt(value));
}

type BuildArgs = {
  addresses: FixtureAddresses;
  operation: "deposit" | "redeem";
  inAmount: bigint;
  outAmount: bigint;
  execution_status?: string;
  /** Mutate a valid receipt into a failure mode. */
  mutate?:
    | "wrong_recipient"
    | "wrong_token"
    | "missing_open_note"
    | "missing_vesu_action"
    | "wrong_vesu_actor"
    | "vesu_output_mismatch"
    | "duplicate_open_note"
    | "amount_mismatch"
    | "malformed_amount"
    | "reverted";
};

/**
 * Build a minimal synthetic STRK20 receipt with Withdrawal + ExternalContractInvoked + OpenNoteDeposited.
 * Event layouts match limen/packages/limen-sdk/src/verify.ts.
 */
export function buildVesuEarnFixtureReceipt(args: BuildArgs): VesuEarnReceiptLike {
  const { addresses, operation, inAmount, outAmount } = args;
  const inToken =
    operation === "deposit" ? addresses.underlyingAddress : addresses.vTokenAddress;
  const outToken =
    operation === "deposit" ? addresses.vTokenAddress : addresses.underlyingAddress;

  let toAddr = addresses.anonymizerAddress;
  let withdrawToken = inToken;
  let withdrawAmount = inAmount;
  let includeOpenNote = true;
  let openNoteToken = outToken;
  let vesuActor = addresses.anonymizerAddress;
  let vesuOutAmount = outAmount;
  let includeVesuAction = true;
  let duplicateOpenNote = false;
  let execution_status = args.execution_status ?? "SUCCEEDED";

  switch (args.mutate) {
    case "wrong_recipient":
      toAddr = "0x222222222222222222222222222222222222222222222222222222222222222";
      break;
    case "wrong_token":
      withdrawToken = outToken;
      openNoteToken = inToken;
      break;
    case "missing_open_note":
      includeOpenNote = false;
      break;
    case "missing_vesu_action":
      includeVesuAction = false;
      break;
    case "wrong_vesu_actor":
      vesuActor = "0x222222222222222222222222222222222222222222222222222222222222222";
      break;
    case "vesu_output_mismatch":
      vesuOutAmount += 1n;
      break;
    case "duplicate_open_note":
      duplicateOpenNote = true;
      break;
    case "amount_mismatch":
      withdrawAmount = inAmount - 1n;
      break;
    case "reverted":
      execution_status = "REVERTED";
      break;
    default:
      break;
  }

  const events: NonNullable<VesuEarnReceiptLike["events"]> = [
    {
      from_address: addresses.privacyPoolAddress,
      keys: [SELECTORS.withdrawal, felt(toAddr), felt(withdrawToken)],
      data: ["0x0", "0x0", "0x0", felt(withdrawAmount)],
    },
    {
      from_address: addresses.privacyPoolAddress,
      keys: [
        SELECTORS.externalContractInvoked,
        felt(addresses.anonymizerAddress),
        SELECTORS.privacyInvoke,
      ],
      data: [],
    },
  ];

  if (includeVesuAction) {
    const assets = operation === "deposit" ? inAmount : vesuOutAmount;
    const shares = operation === "deposit" ? vesuOutAmount : inAmount;
    events.push({
      from_address: addresses.vTokenAddress,
      keys: operation === "deposit"
        ? [SELECTORS.vesuDeposit, felt(vesuActor), felt(vesuActor)]
        : [SELECTORS.vesuWithdraw, felt(vesuActor), felt(vesuActor), felt(vesuActor)],
      data: [felt(assets), "0x0", felt(shares), "0x0"],
    });
  }

  if (includeOpenNote) {
    const event = {
      from_address: addresses.privacyPoolAddress,
      keys: [
        SELECTORS.openNoteDeposited,
        felt(addresses.anonymizerAddress),
        felt(openNoteToken),
        felt(hash.getSelectorFromName("OPEN_NOTE_FIXTURE")),
      ],
      data: [felt(outAmount)],
    };
    events.push(event);
    if (duplicateOpenNote) events.push({ ...event, keys: [...event.keys], data: [...event.data] });
  }

  if (args.mutate === "malformed_amount") events[0]!.data[3] = "not-a-felt";

  return {
    execution_status,
    finality_status: "ACCEPTED_ON_L2",
    block_number: 1,
    events,
  };
}
