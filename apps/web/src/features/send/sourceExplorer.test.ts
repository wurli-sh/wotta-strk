import { describe, expect, it } from "vitest";
import { irisMessageUrl, sourceTxExplorerUrl } from "./sourceExplorer";

describe("source explorer URLs", () => {
  it("branches Base and Solana on network", () => {
    expect(sourceTxExplorerUrl("base", "0xabc", "testnet")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(sourceTxExplorerUrl("base", "0xabc", "mainnet")).toBe("https://basescan.org/tx/0xabc");
    expect(sourceTxExplorerUrl("solana", "sig", "mainnet")).toBe("https://explorer.solana.com/tx/sig");
  });

  it("builds Iris attestation lookup from the source CCTP domain", () => {
    expect(irisMessageUrl("base", "0xabc", "mainnet")).toBe(
      "https://iris-api.circle.com/v2/messages/6?transactionHash=0xabc",
    );
    expect(irisMessageUrl("starknet-private", "0xabc", "mainnet")).toBeNull();
  });
});
