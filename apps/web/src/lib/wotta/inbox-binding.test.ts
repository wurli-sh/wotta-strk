import { describe, expect, it, vi } from "vitest";

vi.mock("@wotta/crypto", () => ({
  publicKeyFromSecret: (secret: string) => `pub:${secret}`,
}));

import { inboxLinkWarning, validateInboxBinding } from "./inbox-binding";

const binding = {
  address: "0x123",
  inbox_pubkey: "pub:secret",
  inbox_key_scheme: "ready_derived_v1" as const,
};

describe("inbox binding validation", () => {
  it("distinguishes unlinked, locked, valid, wrong-wallet, and stale-key states", () => {
    expect(validateInboxBinding(null)).toBe("unlinked");
    expect(validateInboxBinding(binding)).toBe("locked");
    expect(validateInboxBinding(binding, "secret", "0x0123")).toBe("valid");
    expect(validateInboxBinding(binding, "secret", "0x456")).toBe("wrong_wallet");
    expect(validateInboxBinding(binding, "old-secret", "0x123")).toBe("key_mismatch");
  });

  it("flags pre-derived bindings for an explicit upgrade", () => {
    expect(validateInboxBinding({ address: "0x123", inbox_pubkey: "pub:secret" }, "secret"))
      .toBe("upgrade_required");
    expect(inboxLinkWarning("mainnet", "upgrade_required")).toContain("Ready-derived");
  });

  it("warns with the selected network name", () => {
    expect(inboxLinkWarning("mainnet", "key_mismatch")).toContain("Mainnet");
    expect(inboxLinkWarning("mainnet", "key_mismatch")).toContain("upgrade");
    expect(inboxLinkWarning("testnet", "unlinked")).toContain("Sepolia");
    expect(inboxLinkWarning("mainnet", "valid")).toBeNull();
  });
});
