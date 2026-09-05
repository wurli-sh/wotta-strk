import { beforeEach, describe, expect, it } from "vitest";
import { readLedger, recordDeposit, recordRedeem } from "./ledger";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

describe("local Vesu cost-basis ledger", () => {
  beforeEach(() => {
    values.clear();
    Object.assign(globalThis, { window: { localStorage: storage } });
  });

  it("adds only confirmed deposits while preserving the first date", () => {
    recordDeposit("0x1", "0x2", 100_000n, new Date("2026-09-01T00:00:00Z"));
    const entry = recordDeposit("0x01", "0x02", 1_000_000n, new Date("2026-09-02T00:00:00Z"));
    expect(entry.costBasisAssets).toBe("1100000");
    expect(entry.firstDepositAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reduces basis proportionally and clears it after full redemption", () => {
    recordDeposit("0x1", "0x2", 1_000_000n);
    expect(recordRedeem("0x1", "0x2", 10n, 4n)?.costBasisAssets).toBe("400000");
    expect(recordRedeem("0x1", "0x2", 4n, 0n)).toBeNull();
    expect(readLedger("0x1", "0x2")).toBeNull();
  });
});
