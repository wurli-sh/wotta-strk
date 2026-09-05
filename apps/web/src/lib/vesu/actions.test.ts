import { describe, expect, it } from "vitest";
import { splitU256, vesuDepositActions, vesuRedeemActions } from "./actions";
import { loadVesuEarn, type VesuEarnConfig } from "./config";

const config = { ...loadVesuEarn(), status: "verified", anonymizerAddress: "0xabc", anonymizerCompiledClassHash: "0xdef" } as VesuEarnConfig & { anonymizerCompiledClassHash: string };

describe("Vesu STRK20 actions", () => {
  it("splits u256 values above u128", () => {
    expect(splitU256((1n << 128n) + 7n)).toEqual(["0x7", "0x1"]);
  });

  it("builds withdraw, OPEN transfer, invoke in order for deposit", () => {
    const actions = vesuDepositActions("0x123", 100_000n, config);
    expect(actions.map((action) => action.type)).toEqual(["withdraw", "transfer", "invoke"]);
    expect(actions[2]).toMatchObject({ calldata: ["0x0", config.underlyingAddress, config.vTokenAddress, "0x186a0", "0x0", "${openNoteIds[0]}"] });
  });

  it("uses the exact share amount for both redeem withdrawal and calldata", () => {
    const shares = (1n << 128n) + 7n;
    const actions = vesuRedeemActions("0x123", shares, shares, config);
    expect(actions[0]).toMatchObject({ token: config.vTokenAddress, amount: `0x${shares.toString(16)}` });
    expect(actions[2]).toMatchObject({ calldata: ["0x1", config.vTokenAddress, config.underlyingAddress, "0x7", "0x1", "${openNoteIds[0]}"] });
  });

  it("rejects over-balance redemption and unsupported deposits", () => {
    expect(() => vesuRedeemActions("0x123", 2n, 1n, config)).toThrow("invalid_vesu_share_amount");
    expect(() => vesuDepositActions("0x123", 2n, config)).toThrow("unsupported_vesu_deposit_amount");
  });
});
