import { describe, expect, it } from "vitest";
import { DENS, MAINNET_DENS, denominationBaseUnits, isAllowedDenomination } from "./denoms";

describe("dens", () => {
  it("locks 1 10 50 100", () => {
    expect([...DENS]).toEqual([1n, 10n, 50n, 100n]);
    expect([...MAINNET_DENS]).toEqual(["0.5", 1n, 10n, 50n, 100n]);
    expect(denominationBaseUnits("0.5")).toBe(500_000n);
    expect(denominationBaseUnits(50n)).toBe(50_000_000n);
    expect(isAllowedDenomination(10)).toBe(true);
    expect(isAllowedDenomination(11)).toBe(false);
  });
});
