import { describe, expect, it } from "vitest";
import { loadVesuEarn } from "./config";
import { parseVesuMarket } from "./market";

describe("Vesu market parser", () => {
  it("selects only the pinned tuple and scales rates", () => {
    const config = loadVesuEarn();
    const now = new Date("2026-09-05T12:00:00.000Z");
    expect(parseVesuMarket({ data: [{
      pool: { id: config.poolAddress, isDeprecated: false },
      address: config.underlyingAddress,
      vToken: { address: config.vTokenAddress },
      stats: { supplyApy: { value: "35000000000000000", decimals: 18 }, currentUtilization: { value: "830000000000000000", decimals: 18 } },
      config: { lastUpdated: now.toISOString() },
    }] }, now)).toMatchObject({ supplyApy: 3.5, utilization: 83, stale: false });
  });

  it("rejects an unpinned or deprecated market", () => {
    expect(() => parseVesuMarket({ data: [] })).toThrow("vesu_market_unavailable");
  });
});
