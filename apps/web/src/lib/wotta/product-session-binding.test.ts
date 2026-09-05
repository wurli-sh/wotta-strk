import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInboxKeyPair } from "@wotta/crypto";
import { WottaProductSession } from "./product-session";

describe("Ready inbox binding safety", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never unlinks or rotates a published inbox key implicitly", async () => {
    const local = generateInboxKeyPair();
    const published = generateInboxKeyPair();
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      requests.push({ path, method });
      if (path === "/v1/session/sync") return Response.json({ ok: true });
      if (path === "/v1/me") {
        return Response.json({ wallet: { address: "0x123", inbox_pubkey: published.publicKey } });
      }
      return Response.json({ error: `unexpected ${method} ${path}` }, { status: 500 });
    }));

    const supabase = {
      auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } } })) },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const vault = { state: { inboxSecretKey: local.secretKey }, setInboxSecretKey: vi.fn() };

    await expect(session.bindReadyAndIdentity(
      { address: "0x123" } as never,
      vault,
      undefined,
      { reconnect: true },
    )).rejects.toThrow("wallet_inbox_key_mismatch");

    expect(requests).not.toContainEqual({ path: "/v1/wallet/unlink", method: "POST" });
    expect(requests.some(({ path }) => path.startsWith("/v1/wallet/"))).toBe(false);
    expect(vault.setInboxSecretKey).not.toHaveBeenCalled();
  });
});
