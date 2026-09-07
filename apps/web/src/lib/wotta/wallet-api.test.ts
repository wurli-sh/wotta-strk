import { describe, expect, it } from "vitest";
import { toWalletApiFelt } from "./wallet-api";

describe("Wallet API encoding", () => {
  it("removes leading zeroes and preserves zero", () => {
    expect(toWalletApiFelt("0x000abc")).toBe("0xabc");
    expect(toWalletApiFelt("0x0000")).toBe("0x0");
  });

  it("rejects malformed, negative, and out-of-range felts", () => {
    expect(() => toWalletApiFelt("nope")).toThrow("invalid_felt");
    expect(() => toWalletApiFelt(-1n)).toThrow("invalid_felt");
    expect(() => toWalletApiFelt(1n << 252n)).toThrow("invalid_felt");
  });
});
