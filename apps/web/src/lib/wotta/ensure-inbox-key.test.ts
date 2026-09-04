import { describe, expect, it, vi, beforeEach } from "vitest";

const me = vi.fn();
const bindReadyAndIdentity = vi.fn();
const restorePrivacyVaultFromSession = vi.fn();
const unlockPrivacyVault = vi.fn();

vi.mock("@/lib/wotta/product-session", () => ({
  createBrowserProductSession: () => ({ me, bindReadyAndIdentity }),
}));

vi.mock("@/lib/wotta/privacy-state", () => ({
  restorePrivacyVaultFromSession: (...args: unknown[]) => restorePrivacyVaultFromSession(...args),
  unlockPrivacyVault: (...args: unknown[]) => unlockPrivacyVault(...args),
}));

vi.mock("@wotta/crypto", () => ({
  publicKeyFromSecret: (secret: string) => `pub:${secret}`,
}));

vi.mock("@/lib/wotta/privacy-config", () => ({
  directPrivacyConfig: () => ({ chainId: "SN_SEPOLIA", poolAddress: "0xsepolia" }),
}));

vi.mock("@/lib/wotta/mainnet-privacy", () => ({
  mainnetPrivacyConfig: () => ({ chainId: "SN_MAIN", poolAddress: "0xmain" }),
}));

import { ensureClaimInboxKey } from "./ensure-inbox-key";

describe("ensureClaimInboxKey", () => {
  beforeEach(() => {
    me.mockReset();
    bindReadyAndIdentity.mockReset();
    restorePrivacyVaultFromSession.mockReset();
    unlockPrivacyVault.mockReset();
  });

  it("no-ops when the local secret already matches the linked inbox", async () => {
    me.mockResolvedValue({ wallet: { address: "0x1", inbox_pubkey: "pub:secret" } });
    const vault = {
      state: { inboxSecretKey: "secret" },
      setInboxSecretKey: vi.fn(),
    };
    const result = await ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "mainnet");
    expect(result).toEqual({ rebound: false });
    expect(bindReadyAndIdentity).not.toHaveBeenCalled();
    expect(restorePrivacyVaultFromSession).not.toHaveBeenCalled();
  });

  it("copies a matching secret from the other network vault before re-linking", async () => {
    me.mockResolvedValue({ wallet: { address: "0x1", inbox_pubkey: "pub:recovered" } });
    restorePrivacyVaultFromSession.mockResolvedValue({
      state: { inboxSecretKey: "recovered" },
    });
    const setInboxSecretKey = vi.fn();
    const vault = { state: { inboxSecretKey: undefined }, setInboxSecretKey };
    const result = await ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "mainnet");
    expect(result).toEqual({ rebound: false });
    expect(setInboxSecretKey).toHaveBeenCalledWith("recovered");
    expect(bindReadyAndIdentity).not.toHaveBeenCalled();
  });

  it("refuses to re-link when a wallet is already bound but the secret is missing", async () => {
    me.mockResolvedValue({ wallet: { address: "0x1", inbox_pubkey: "pub:old" } });
    restorePrivacyVaultFromSession.mockResolvedValue(null);
    unlockPrivacyVault.mockResolvedValue({ state: {} });
    const vault = { state: { inboxSecretKey: undefined as string | undefined }, setInboxSecretKey: vi.fn() };
    await expect(
      ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "testnet"),
    ).rejects.toThrow(/can’t decrypt your inbox/);
    expect(bindReadyAndIdentity).not.toHaveBeenCalled();
  });

  it("links when no wallet is bound yet", async () => {
    me.mockResolvedValue({ wallet: null });
    restorePrivacyVaultFromSession.mockResolvedValue(null);
    unlockPrivacyVault.mockResolvedValue({ state: {} });
    bindReadyAndIdentity.mockImplementation(async (_account, vault) => {
      vault.state.inboxSecretKey = "fresh";
    });
    const vault = { state: { inboxSecretKey: undefined as string | undefined }, setInboxSecretKey: vi.fn() };
    const result = await ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "testnet");
    expect(result).toEqual({ rebound: true });
    expect(bindReadyAndIdentity).toHaveBeenCalledOnce();
  });
});
