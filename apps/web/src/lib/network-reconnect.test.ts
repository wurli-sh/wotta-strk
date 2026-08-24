import { describe, expect, it } from "vitest";
import { isPrivacyReconnectError, networkReconnectTitle } from "./network-reconnect";

describe("network reconnect helpers", () => {
  it("detects privacy viewing-key mismatch errors", () => {
    expect(isPrivacyReconnectError(new Error("privacy_viewing_key_mismatch"))).toBe(true);
    expect(
      isPrivacyReconnectError(
        new Error('Indexer API failed: viewing_key does not match the registered public key'),
      ),
    ).toBe(true);
    expect(isPrivacyReconnectError(new Error("wallet_binding_ambiguous"))).toBe(true);
    expect(isPrivacyReconnectError(new Error("unauthorized"))).toBe(false);
  });

  it("labels reconnect prompts by network", () => {
    expect(networkReconnectTitle("mainnet")).toContain("Mainnet");
    expect(networkReconnectTitle("testnet")).toContain("Sepolia");
  });
});
