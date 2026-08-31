import { describe, expect, it } from "vitest";
import { materializePrivacyState } from "./privacy-state";

describe("materializePrivacyState", () => {
  it("keeps a version-2 vault intact", () => {
    const state = {
      version: 2 as const,
      viewingKey: "0xabc",
      identityAddress: "0x123",
      identityClassHash: "0xclass",
      inboxSecretKey: "secret",
    };
    expect(materializePrivacyState(state)).toEqual(state);
  });

  it("promotes a version-1 vault without rotating the viewing key", () => {
    expect(
      materializePrivacyState({
        version: 1,
        viewingKey: "0xdef",
        identityAddress: "0x456",
        inboxSecretKey: "inbox",
      }),
    ).toEqual({
      version: 2,
      viewingKey: "0xdef",
      identityAddress: "0x456",
      inboxSecretKey: "inbox",
    });
  });

  it("only mints a viewing key when no encrypted state exists", () => {
    const minted = materializePrivacyState(null);
    expect(minted.version).toBe(2);
    expect(minted.viewingKey).toMatch(/^0x[0-9a-f]+$/);
    expect(minted.identityAddress).toBeUndefined();
  });

  it("rotates a zero viewing key instead of reusing it", () => {
    const minted = materializePrivacyState({
      version: 2,
      viewingKey: "0x0",
    });
    expect(minted.viewingKey).not.toBe("0x0");
    expect(BigInt(minted.viewingKey)).toBeGreaterThan(0n);
  });
});
