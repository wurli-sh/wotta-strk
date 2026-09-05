import { describe, expect, it } from "vitest";
import { calculatePnl } from "./position";

describe("Vesu position math", () => {
  it("calculates signed P&L and basis points without floating point", () => {
    expect(calculatePnl(1_050_000n, 1_000_000n)).toEqual({ assets: 50_000n, basisPoints: 500n });
    expect(calculatePnl(900_000n, 1_000_000n)).toEqual({ assets: -100_000n, basisPoints: -1_000n });
  });

  it("does not invent P&L without local basis", () => {
    expect(calculatePnl(1_000_000n, null)).toBeNull();
  });
});
