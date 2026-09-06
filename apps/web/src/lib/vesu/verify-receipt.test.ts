import { describe, expect, it } from "vitest";
import { loadVesuEarn } from "./config";
import {
  buildVesuEarnFixtureReceipt,
  FIXTURE_ANONYMIZER,
  fixtureExpected,
} from "./fixtures/vesu-earn-receipts";
import { verifyVesuEarnReceipt, verifyVesuEarnTransaction } from "./verify-receipt";

const base = loadVesuEarn();
const addresses = {
  privacyPoolAddress: base.privacyPoolAddress,
  anonymizerAddress: FIXTURE_ANONYMIZER,
  underlyingAddress: base.underlyingAddress,
  vTokenAddress: base.vTokenAddress,
};

describe("verifyVesuEarnReceipt", () => {
  it("accepts a well-formed deposit fixture", () => {
    const amount = 100_000n;
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: amount,
      outAmount: 99_000n,
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", amount),
      "0xdeposit",
    );
    expect(result.ok).toBe(true);
    expect(result.checks.privacyInvokeOnly).toBe(true);
    expect(result.checks.privateSourced).toBe(true);
    expect(result.checks.vesuActionObserved).toBe(true);
    expect(result.checks.vesuOutputMatches).toBe(true);
    expect(result.observed.creditedToOpenNote).toBe("99000");
  });

  it("accepts a well-formed redeem fixture", () => {
    const shares = 1_000_000_000_000_000_000n;
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "redeem",
      inAmount: shares,
      outAmount: 100_000n,
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "redeem", shares),
    );
    expect(result.ok).toBe(true);
    expect(result.checks.openNoteTokenMatches).toBe(true);
  });

  it("rejects wrong withdrawal recipient", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 1n,
      mutate: "wrong_recipient",
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.withdrawalToAnonymizer).toBe(false);
  });

  it("rejects wrong withdrawal / open-note tokens", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 1n,
      mutate: "wrong_token",
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.withdrawalTokenMatches).toBe(false);
    expect(result.checks.openNoteTokenMatches).toBe(false);
  });

  it("rejects missing open-note credit", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 1n,
      mutate: "missing_open_note",
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.openNoteCredited).toBe(false);
  });

  it("rejects amount mismatch (not fully private-sourced)", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 1n,
      mutate: "amount_mismatch",
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.privateSourced).toBe(false);
  });

  it("rejects reverted execution", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 1n,
      mutate: "reverted",
    });
    const result = verifyVesuEarnReceipt(
      receipt,
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.succeeded).toBe(false);
    expect(result.status).toBe("failed");
  });

  it.each([
    ["missing_vesu_action", "vesuActionObserved"],
    ["wrong_vesu_actor", "vesuActorsMatch"],
    ["vesu_output_mismatch", "vesuOutputMatches"],
  ] as const)("rejects %s", (mutate, failedCheck) => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 99_000n,
      mutate,
    });
    const result = verifyVesuEarnReceipt(receipt, fixtureExpected(addresses, "deposit", 100_000n));
    expect(result.ok).toBe(false);
    expect(result.checks[failedCheck]).toBe(false);
  });

  it("rejects duplicate evidence instead of choosing a convenient event", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 99_000n,
      mutate: "duplicate_open_note",
    });
    const result = verifyVesuEarnReceipt(receipt, fixtureExpected(addresses, "deposit", 100_000n));
    expect(result.ok).toBe(false);
    expect(result.problems).toContain("expected exactly one pool OpenNoteDeposited event; observed 2");
  });

  it("returns a failed result for malformed receipt felts", () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 99_000n,
      mutate: "malformed_amount",
    });
    expect(() => verifyVesuEarnReceipt(receipt, fixtureExpected(addresses, "deposit", 100_000n))).not.toThrow();
    expect(verifyVesuEarnReceipt(receipt, fixtureExpected(addresses, "deposit", 100_000n)).ok).toBe(false);
  });

  it("checks zero anonymizer balances at the receipt block", async () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 99_000n,
    });
    const calls: Array<number | string> = [];
    const provider = {
      getTransactionReceipt: async () => receipt,
      callContract: async (_request: unknown, block: number | string) => {
        calls.push(block);
        return ["0x0", "0x0"];
      },
    };
    const result = await verifyVesuEarnTransaction(
      provider as never,
      "0x123",
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(true);
    expect(result.checks.anonymizerBalancesCleared).toBe(true);
    expect(calls).toEqual([1, 1]);
  });

  it("rejects a successful transaction that stranded token residue", async () => {
    const receipt = buildVesuEarnFixtureReceipt({
      addresses,
      operation: "deposit",
      inAmount: 100_000n,
      outAmount: 99_000n,
    });
    const provider = {
      getTransactionReceipt: async () => receipt,
      callContract: async () => ["0x1", "0x0"],
    };
    const result = await verifyVesuEarnTransaction(
      provider as never,
      "0x123",
      fixtureExpected(addresses, "deposit", 100_000n),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.anonymizerBalancesCleared).toBe(false);
  });
});
