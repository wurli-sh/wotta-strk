import type {
  NormalizedInvokeAction,
  NormalizedTransferAction,
} from "./types.ts";

/** Wallet API 0.10.3 encodes numeric STRK20 amounts as Starknet felts. */
export function decimalAmountToFelt(amount: string): `0x${string}` {
  if (!/^\d+$/.test(amount)) {
    throw new Error("STRK20 amount must be a non-negative decimal integer");
  }
  return `0x${BigInt(amount).toString(16)}`;
}

export function buildShieldRegisterActions(input: {
  token: string;
  amount: string;
}): Array<{ type: "deposit"; token: string; amount: string }> {
  return [
    {
      type: "deposit",
      token: input.token,
      amount: decimalAmountToFelt(input.amount),
    },
  ];
}

/** Cairo enum EscrowOperation::Deposit */
export const ESCROW_DEPOSIT = "0x0";
/** Cairo enum EscrowOperation::Claim */
export const ESCROW_CLAIM = "0x1";

export function buildDirectTransferActions(input: {
  token: string;
  amount: string;
  recipient: string;
}): NormalizedTransferAction[] {
  return [
    {
      type: "transfer",
      token: input.token,
      amount: decimalAmountToFelt(input.amount),
      recipient: input.recipient,
    },
  ];
}

export function buildPrivateFundActions(input: {
  helper: string;
  token: string;
  amount: string;
  commitmentHash: string;
}): NormalizedInvokeAction[] {
  return [
    {
      type: "invoke",
      contract: input.helper,
      calldata: [
        ESCROW_DEPOSIT,
        input.commitmentHash,
        input.token,
        decimalAmountToFelt(input.amount),
        "0x0",
        "0x0",
      ],
    },
  ];
}

export function buildClaimReleaseActions(input: {
  helper: string;
  token: string;
  recipient: string;
  secret: string;
}): Array<NormalizedTransferAction | NormalizedInvokeAction> {
  return [
    {
      type: "transfer",
      token: input.token,
      amount: "OPEN",
      recipient: input.recipient,
    },
    {
      type: "invoke",
      contract: input.helper,
      calldata: [
        ESCROW_CLAIM,
        "0x0",
        input.token,
        "0x0",
        input.secret,
        "${openNoteIds[0]}",
      ],
    },
  ];
}
