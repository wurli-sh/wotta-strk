import { describe, expect, it } from "vitest";
import { DENS, isAllowedDenomination } from "./denoms";

describe("dens", () => {
  it("locks 1 10 50 100", () => {
    expect([...DENS]).toEqual([1n, 10n, 50n, 100n]);
    expect(isAllowedDenomination(10)).toBe(true);
    expect(isAllowedDenomination(11)).toBe(false);
  });
});
