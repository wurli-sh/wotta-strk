import { describe, expect, it } from "vitest";
import { canDeposit, canWithdraw, loadVesuEarn, type VesuEarnConfig } from "./config";

function live(status: VesuEarnConfig["status"]): VesuEarnConfig {
  return { ...loadVesuEarn(), status, anonymizerAddress: "0xabc", anonymizerCompiledClassHash: "0xdef" } as VesuEarnConfig & { anonymizerCompiledClassHash: string };
}

describe("Vesu admission", () => {
  it("fails closed while the manifest is pending", () => {
    const config = live("pending");
    expect(canDeposit({ mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", amount: 100_000n }, config)).toBe(false);
    expect(canWithdraw({ mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", privateShares: 1n }, config)).toBe(false);
  });

  it("allows only the 0.1 USDC operator smoke while pending", () => {
    const config = live("pending");
    const policy = { allowPendingSmoke: true };
    expect(canDeposit(
      { mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", amount: 100_000n },
      config,
      policy,
    )).toBe(true);
    expect(canDeposit(
      { mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", amount: 1_000_000n },
      config,
      policy,
    )).toBe(false);
    expect(canWithdraw(
      { mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", privateShares: 1n },
      config,
      policy,
    )).toBe(true);
  });

  it("requires mainnet, the linked Ready address, and the intersected amount allowlist", () => {
    const config = live("verified");
    expect(canDeposit({ mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x01", amount: 100_000n }, config)).toBe(true);
    expect(canDeposit({ mode: "testnet", readyAddress: "0x1", linkedAddress: "0x1", amount: 100_000n }, config)).toBe(false);
    expect(canDeposit({ mode: "mainnet", readyAddress: "0x2", linkedAddress: "0x1", amount: 100_000n }, config)).toBe(false);
    expect(canDeposit({ mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x1", amount: 10_000_000n }, config)).toBe(false);
  });

  it("keeps withdrawal available in withdraw-only mode", () => {
    expect(canWithdraw({ mode: "mainnet", readyAddress: "0x1", linkedAddress: "0x1", privateShares: 1n }, live("withdraw_only"))).toBe(true);
  });
});
