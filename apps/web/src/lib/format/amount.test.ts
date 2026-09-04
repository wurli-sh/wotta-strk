import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdcInput } from "./amount";

describe("formatUsdc", () => {
  it("renders fractional and whole USDC without Number truncation", () => {
    expect(formatUsdc(0n)).toBe("0");
    expect(formatUsdc(100_000n)).toBe("0.1");
    expect(formatUsdc(1_000_000n)).toBe("1");
    expect(formatUsdc("100000")).toBe("0.1");
    expect(formatUsdc(10_000_000)).toBe("10");
  });

  it("parses typed USDC input back to base units", () => {
    expect(parseUsdcInput("0.1")).toBe(100_000n);
    expect(parseUsdcInput("1")).toBe(1_000_000n);
  });
});
