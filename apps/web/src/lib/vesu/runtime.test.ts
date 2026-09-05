import { describe, expect, it } from "vitest";
import type { WalletAccountV6 } from "starknet";
import { assertVesuRuntime } from "./runtime";

describe("Vesu runtime validation", () => {
  it("fails before RPC while the manifest is pending", async () => {
    let called = false;
    const account = { provider: { getClassHashAt: async () => { called = true; return "0x1"; } } } as unknown as WalletAccountV6;
    await expect(assertVesuRuntime(account)).rejects.toThrow("vesu_earn_pending");
    expect(called).toBe(false);
  });
});
