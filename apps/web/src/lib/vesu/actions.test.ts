import { describe, expect, it } from "vitest";
import { splitU256, toWalletApiFelt, vesuDepositActions, vesuRedeemActions } from "./actions";
import { loadVesuEarn, type VesuEarnConfig } from "./config";

/** Wallet API 0.10.3 FELT pattern from starknet-types. */
const WALLET_API_FELT = /^0x(0|[a-fA-F1-9]{1}[a-fA-F0-9]{0,62})$/;

const config = {
  ...loadVesuEarn(),
  status: "verified",
  anonymizerAddress: "0x0abc",
  underlyingAddress: "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb",
  vTokenAddress: "0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65",
  anonymizerCompiledClassHash: "0xdef",
} as VesuEarnConfig & { anonymizerCompiledClassHash: string };

describe("Vesu STRK20 actions", () => {
  it("splits u256 values above u128", () => {
    expect(splitU256((1n << 128n) + 7n)).toEqual(["0x7", "0x1"]);
  });

  it("canonicalizes addresses to Wallet API FELT form (no leading zeros)", () => {
    expect(toWalletApiFelt("0x0abc")).toBe("0xabc");
    expect(toWalletApiFelt(config.underlyingAddress)).toBe(
      "0x33068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    );
    expect(WALLET_API_FELT.test(toWalletApiFelt(config.underlyingAddress))).toBe(true);
    expect(WALLET_API_FELT.test(config.underlyingAddress)).toBe(false);
  });

  it("keeps note-selection token addresses in manifest form, canonicalizes invoke calldata", () => {
    const actions = vesuDepositActions("0x0123", 100_000n, config);
    expect(actions.map((action) => action.type)).toEqual(["withdraw", "transfer", "invoke"]);
    // Ready indexes private notes under the same padded token forms used by shield/claim.
    expect(actions[0]).toMatchObject({
      token: config.underlyingAddress,
      recipient: toWalletApiFelt(config.anonymizerAddress),
      amount: "0x186a0",
    });
    expect(actions[1]).toMatchObject({
      token: config.vTokenAddress,
      recipient: "0x0123",
      amount: "OPEN",
    });
    // Invoke calldata must be Wallet-API FELT-safe or Ready returns INVALID_REQUEST_PAYLOAD.
    expect(actions[2]).toMatchObject({
      contract: toWalletApiFelt(config.anonymizerAddress),
      calldata: [
        "0x0",
        toWalletApiFelt(config.underlyingAddress),
        toWalletApiFelt(config.vTokenAddress),
        "0x186a0",
        "0x0",
        "${openNoteIds[0]}",
      ],
    });
    for (const item of (actions[2] as { calldata: string[] }).calldata) {
      if (item.startsWith("${")) continue;
      expect(item).toMatch(WALLET_API_FELT);
    }
  });

  it("uses the exact share amount for both redeem withdrawal and calldata", () => {
    const shares = (1n << 128n) + 7n;
    const actions = vesuRedeemActions("0x123", shares, shares, config);
    expect(actions[0]).toMatchObject({
      token: config.vTokenAddress,
      amount: `0x${shares.toString(16)}`,
    });
    expect(actions[2]).toMatchObject({
      calldata: [
        "0x1",
        toWalletApiFelt(config.vTokenAddress),
        toWalletApiFelt(config.underlyingAddress),
        "0x7",
        "0x1",
        "${openNoteIds[0]}",
      ],
    });
  });

  it("rejects over-balance redemption and unsupported deposits", () => {
    expect(() => vesuRedeemActions("0x123", 2n, 1n, config)).toThrow("invalid_vesu_share_amount");
    expect(() => vesuDepositActions("0x123", 2n, config)).toThrow("unsupported_vesu_deposit_amount");
  });
});
