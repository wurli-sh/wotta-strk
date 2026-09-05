import { describe, expect, it } from "vitest";
import { rememberApySnapshot } from "./market-snapshot";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("rememberApySnapshot", () => {
  it("compares distinct API updates for the same market", () => {
    const storage = memoryStorage();
    const first = {
      supplyApy: 3.5,
      utilization: 80,
      updatedAt: new Date("2026-09-05T10:00:00Z"),
      stale: false,
    };
    const second = {
      ...first,
      supplyApy: 3.75,
      updatedAt: new Date("2026-09-05T10:01:00Z"),
    };

    expect(rememberApySnapshot("0xpool", "0xusdc", first, storage)).toBeNull();
    expect(rememberApySnapshot("0xpool", "0xusdc", second, storage)).toBe(3.5);
    expect(rememberApySnapshot("0xpool", "0xusdc", second, storage)).toBe(3.5);
  });
});
