import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInboxKeyPair } from "@wotta/crypto";

const deriveInboxKeyPair = vi.fn();

vi.mock("./ready", () => ({
  connectReady: vi.fn(),
  ensureReadyChain: vi.fn(),
}));

vi.mock("./inbox-key-derive", () => ({
  chainIdForNetwork: (network: string) =>
    network === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA",
  deriveInboxKeyPair: (...args: unknown[]) => deriveInboxKeyPair(...args),
}));

import { WottaProductSession } from "./product-session";

describe("Ready inbox binding safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    deriveInboxKeyPair.mockReset();
  });

  it("never unlinks or rotates a published inbox key implicitly", async () => {
    const local = generateInboxKeyPair();
    const published = generateInboxKeyPair();
    const derived = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const method = init?.method ?? "GET";
        requests.push({ path, method });
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") {
          return Response.json({
            wallet: { address: "0x123", inbox_pubkey: published.publicKey },
          });
        }
        return Response.json(
          { error: `unexpected ${method} ${path}` },
          { status: 500 },
        );
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const vault = {
      state: { inboxSecretKey: local.secretKey },
      setInboxSecretKey: vi.fn(),
    };

    await expect(
      session.bindReadyAndIdentity(
        { address: "0x123", signMessage: vi.fn() } as never,
        vault,
        undefined,
        { reconnect: true },
      ),
    ).rejects.toThrow("wallet_inbox_key_mismatch");

    expect(requests).not.toContainEqual({
      path: "/v1/wallet/unlink",
      method: "POST",
    });
    expect(requests.some(({ path }) => path.startsWith("/v1/wallet/"))).toBe(
      false,
    );
    expect(vault.setInboxSecretKey).not.toHaveBeenCalled();
  });

  it("publishes a derived key on fresh bind", async () => {
    const derived = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    let linkBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") return Response.json({ wallet: null });
        if (path === "/v1/wallet/challenge") {
          return Response.json({
            typedData: {
              domain: {},
              types: {},
              primaryType: "Test",
              message: {},
            },
          });
        }
        if (path === "/v1/wallet/link") {
          linkBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Response.json({ address: "0x123" });
        }
        return Response.json({ error: `unexpected ${path}` }, { status: 500 });
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const state = { inboxSecretKey: undefined as string | undefined };
    const vault = {
      state,
      setInboxSecretKey: vi.fn(async (secret: string) => {
        state.inboxSecretKey = secret;
      }),
    };

    await session.bindReadyAndIdentity(
      {
        address: "0x123",
        signMessage: vi.fn(async () => ["0x1", "0x2"]),
      } as never,
      vault,
    );

    expect(deriveInboxKeyPair).toHaveBeenCalledOnce();
    expect(vault.setInboxSecretKey).toHaveBeenCalledWith(derived.secretKey);
    expect(linkBody).toMatchObject({
      inboxPublicKey: derived.publicKey,
      rotateInboxKey: false,
    });
  });

  it("reconnects with a matching derived key without rotate", async () => {
    const derived = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    let linkBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") {
          return Response.json({
            wallet: { address: "0x123", inbox_pubkey: derived.publicKey },
          });
        }
        if (path === "/v1/wallet/challenge") {
          return Response.json({
            typedData: {
              domain: {},
              types: {},
              primaryType: "Test",
              message: {},
            },
          });
        }
        if (path === "/v1/wallet/link") {
          linkBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Response.json({ reconnected: true });
        }
        return Response.json({ error: `unexpected ${path}` }, { status: 500 });
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const state = { inboxSecretKey: undefined as string | undefined };
    const vault = {
      state,
      setInboxSecretKey: vi.fn(async (secret: string) => {
        state.inboxSecretKey = secret;
      }),
    };

    await session.bindReadyAndIdentity(
      {
        address: "0x123",
        signMessage: vi.fn(async () => ["0x1", "0x2"]),
      } as never,
      vault,
      undefined,
      { reconnect: true },
    );

    expect(linkBody).toMatchObject({
      inboxPublicKey: derived.publicKey,
      rotateInboxKey: false,
    });
  });

  it("keeps a legacy matching secret on reconnect without upgrading", async () => {
    const legacy = generateInboxKeyPair();
    const derived = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    let linkBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") {
          return Response.json({
            wallet: { address: "0x123", inbox_pubkey: legacy.publicKey },
          });
        }
        if (path === "/v1/wallet/challenge") {
          return Response.json({
            typedData: {
              domain: {},
              types: {},
              primaryType: "Test",
              message: {},
            },
          });
        }
        if (path === "/v1/wallet/link") {
          linkBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Response.json({ reconnected: true });
        }
        return Response.json({ error: `unexpected ${path}` }, { status: 500 });
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const vault = {
      state: { inboxSecretKey: legacy.secretKey },
      setInboxSecretKey: vi.fn(),
    };

    await session.bindReadyAndIdentity(
      {
        address: "0x123",
        signMessage: vi.fn(async () => ["0x1", "0x2"]),
      } as never,
      vault,
      undefined,
      { reconnect: true },
    );

    expect(deriveInboxKeyPair).not.toHaveBeenCalled();
    expect(vault.setInboxSecretKey).not.toHaveBeenCalled();
    expect(linkBody).toMatchObject({
      inboxPublicKey: legacy.publicKey,
      rotateInboxKey: false,
    });
  });

  it("rotates only after explicit Account upgrade confirmation", async () => {
    const published = generateInboxKeyPair();
    const derived = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    let linkBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") {
          return Response.json({
            wallet: { address: "0x123", inbox_pubkey: published.publicKey },
          });
        }
        if (path === "/v1/wallet/challenge") {
          return Response.json({
            typedData: {
              domain: {},
              types: {},
              primaryType: "Test",
              message: {},
            },
          });
        }
        if (path === "/v1/wallet/link") {
          linkBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Response.json({ reconnected: true, keyRotated: true });
        }
        return Response.json({ error: `unexpected ${path}` }, { status: 500 });
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const state = { inboxSecretKey: undefined as string | undefined };
    const vault = {
      state,
      setInboxSecretKey: vi.fn(async (secret: string) => {
        state.inboxSecretKey = secret;
      }),
    };

    await session.bindReadyAndIdentity(
      {
        address: "0x123",
        signMessage: vi.fn(async () => ["0x1", "0x2"]),
      } as never,
      vault,
      undefined,
      { reconnect: true, rotateInboxKey: true },
    );

    expect(vault.setInboxSecretKey).toHaveBeenCalledWith(derived.secretKey);
    expect(linkBody).toMatchObject({
      inboxPublicKey: derived.publicKey,
      rotateInboxKey: true,
    });
  });

  it("does not persist a derived secret when rotate link fails", async () => {
    const published = generateInboxKeyPair();
    const derived = generateInboxKeyPair();
    const legacy = generateInboxKeyPair();
    deriveInboxKeyPair.mockResolvedValue(derived);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path === "/v1/session/sync") return Response.json({ ok: true });
        if (path === "/v1/me") {
          return Response.json({
            wallet: { address: "0x123", inbox_pubkey: published.publicKey },
          });
        }
        if (path === "/v1/wallet/challenge") {
          return Response.json({
            typedData: {
              domain: {},
              types: {},
              primaryType: "Test",
              message: {},
            },
          });
        }
        if (path === "/v1/wallet/link") {
          return Response.json(
            { error: { message: "challenge_invalid" } },
            { status: 409 },
          );
        }
        return Response.json({ error: `unexpected ${path}` }, { status: 500 });
      }),
    );

    const supabase = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "token" } },
        })),
      },
    };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const vault = {
      state: { inboxSecretKey: legacy.secretKey },
      setInboxSecretKey: vi.fn(),
    };

    await expect(
      session.bindReadyAndIdentity(
        {
          address: "0x123",
          signMessage: vi.fn(async () => ["0x1", "0x2"]),
        } as never,
        vault,
        undefined,
        { rotateInboxKey: true },
      ),
    ).rejects.toThrow(/challenge_invalid|Wotta API 409/);

    expect(vault.setInboxSecretKey).not.toHaveBeenCalled();
    expect(vault.state.inboxSecretKey).toBe(legacy.secretKey);
  });
});
