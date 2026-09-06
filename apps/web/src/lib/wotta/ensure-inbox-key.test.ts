import { describe, expect, it, vi, beforeEach } from "vitest";

const me = vi.fn();
const bindReadyAndIdentity = vi.fn();
const deriveInboxKeyPair = vi.fn();

vi.mock("@/lib/wotta/product-session", () => ({
  createBrowserProductSession: () => ({ me, bindReadyAndIdentity }),
}));

vi.mock("@/lib/wotta/inbox-key-derive", () => ({
  chainIdForNetwork: (network: string) =>
    network === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA",
  deriveInboxKeyPair: (...args: unknown[]) => deriveInboxKeyPair(...args),
}));

vi.mock("@wotta/crypto", () => ({
  publicKeyFromSecret: (secret: string) => `pub:${secret}`,
}));

import { ensureClaimInboxKey } from "./ensure-inbox-key";

describe("ensureClaimInboxKey", () => {
  beforeEach(() => {
    me.mockReset();
    bindReadyAndIdentity.mockReset();
    deriveInboxKeyPair.mockReset();
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
    expect(deriveInboxKeyPair).not.toHaveBeenCalled();
  });

  it("re-derives from Ready when the published pubkey matches", async () => {
    me.mockResolvedValue({ wallet: { address: "0x1", inbox_pubkey: "pub:recovered" } });
    deriveInboxKeyPair.mockResolvedValue({
      publicKey: "pub:recovered",
      secretKey: "recovered",
    });
    const setInboxSecretKey = vi.fn();
    const vault = { state: { inboxSecretKey: undefined }, setInboxSecretKey };
    const result = await ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "mainnet");
    expect(result).toEqual({ rebound: false });
    expect(setInboxSecretKey).toHaveBeenCalledWith("recovered");
    expect(bindReadyAndIdentity).not.toHaveBeenCalled();
  });

  it("refuses to re-link when a wallet is already bound but derivation mismatches", async () => {
    me.mockResolvedValue({ wallet: { address: "0x1", inbox_pubkey: "pub:old" } });
    deriveInboxKeyPair.mockResolvedValue({
      publicKey: "pub:new",
      secretKey: "new",
    });
    const vault = { state: { inboxSecretKey: undefined as string | undefined }, setInboxSecretKey: vi.fn() };
    await expect(
      ensureClaimInboxKey(vault as never, { address: "0x1" } as never, "testnet"),
    ).rejects.toThrow(/can’t decrypt your inbox/);
    expect(bindReadyAndIdentity).not.toHaveBeenCalled();
  });

  it("links when no wallet is bound yet even if a stale vault secret exists", async () => {
    me.mockResolvedValue({ wallet: null });
    bindReadyAndIdentity.mockImplementation(async (_account, vault) => {
      vault.state.inboxSecretKey = "fresh";
    });
    const vault = {
      state: { inboxSecretKey: "stale" as string | undefined },
      setInboxSecretKey: vi.fn(),
    };
    const result = await ensureClaimInboxKey(
      vault as never,
      { address: "0x1" } as never,
      "testnet",
    );
    expect(result).toEqual({ rebound: true });
    expect(bindReadyAndIdentity).toHaveBeenCalledOnce();
  });
});
