import { describe, expect, it } from "vitest";
import {
  DENS,
  MAINNET_DENS,
  MAINNET_DISPLAY_DENS,
  coerceMainnetDenomination,
  denominationBaseUnits,
  isAllowedDenomination,
  isMainnetDenomination,
} from "./denoms";

describe("dens", () => {
  it("locks testnet dens to 1 10 50 100", () => {
    expect([...DENS]).toEqual([1n, 10n, 50n, 100n]);
    expect(denominationBaseUnits(50n)).toBe(50_000_000n);
    expect(isAllowedDenomination(10)).toBe(true);
    expect(isAllowedDenomination(11)).toBe(false);
  });

  it("locks mainnet selectable dens to deployed 0.1 and 1 USDC", () => {
    expect([...MAINNET_DENS]).toEqual(["0.1", 1n]);
    expect([...MAINNET_DISPLAY_DENS]).toEqual(["0.1", 1n, 10n, 50n, 100n]);
    expect(denominationBaseUnits("0.1")).toBe(100_000n);
    expect(denominationBaseUnits(1n)).toBe(1_000_000n);
    expect(isMainnetDenomination("0.1")).toBe(true);
    expect(isMainnetDenomination(10n)).toBe(false);
    expect(coerceMainnetDenomination(100n)).toBe("0.1");
    expect(coerceMainnetDenomination(1n)).toBe(1n);
  });
});
