import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClaimReleaseActions,
  buildDirectTransferActions,
  buildPrivateFundActions,
  buildShieldRegisterActions,
  decimalAmountToFelt,
  ESCROW_CLAIM,
  ESCROW_DEPOSIT,
} from "./actions.ts";

const USDC =
  "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb";
const HELPER =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const RECIPIENT =
  "0x0abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefab";
const COMMITMENT = "0x111";
const AMOUNT = "1000000";

test("buildShieldRegisterActions emits a public-to-private deposit", () => {
  assert.deepEqual(
    buildShieldRegisterActions({ token: USDC, amount: AMOUNT }),
    [{ type: "deposit", token: USDC, amount: "0xf4240" }],
  );
});

test("buildDirectTransferActions emits a private transfer", () => {
  assert.deepEqual(
    buildDirectTransferActions({
      token: USDC,
      amount: AMOUNT,
      recipient: RECIPIENT,
    }),
    [
      {
        type: "transfer",
        token: USDC,
        amount: "0xf4240",
        recipient: RECIPIENT,
      },
    ],
  );
});

test("buildPrivateFundActions parks funds without an OPEN note", () => {
  assert.deepEqual(
    buildPrivateFundActions({
      helper: HELPER,
      token: USDC,
      amount: AMOUNT,
      commitmentHash: COMMITMENT,
    }),
    [
      {
        type: "invoke",
        contract: HELPER,
        calldata: [
          ESCROW_DEPOSIT,
          COMMITMENT,
          USDC,
          "0xf4240",
          "0x0",
          "0x0",
        ],
      },
    ],
  );
});

test("decimalAmountToFelt emits canonical Wallet API felt values", () => {
  assert.equal(decimalAmountToFelt("0"), "0x0");
  assert.equal(decimalAmountToFelt(AMOUNT), "0xf4240");
  assert.throws(() => decimalAmountToFelt("0xf4240"), /decimal integer/);
});

test("buildClaimReleaseActions opens a note then claims into it", () => {
  assert.deepEqual(
    buildClaimReleaseActions({
      helper: HELPER,
      token: USDC,
      recipient: RECIPIENT,
      secret: "0x222",
    }),
    [
      {
        type: "transfer",
        token: USDC,
        amount: "OPEN",
        recipient: RECIPIENT,
      },
      {
        type: "invoke",
        contract: HELPER,
        calldata: [
          ESCROW_CLAIM,
          "0x0",
          USDC,
          "0x0",
          "0x222",
          "${openNoteIds[0]}",
        ],
      },
    ],
  );
});
