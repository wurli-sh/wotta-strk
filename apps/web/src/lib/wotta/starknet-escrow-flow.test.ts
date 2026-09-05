import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateInboxKeyPair } from "@wotta/crypto";

const mocks = vi.hoisted(() => ({
  executeDeposit: vi.fn(async () => ({ txHash: "0xdead" })),
  connectReady: vi.fn(async () => ({ account: {}, address: "0xabc", walletName: "Ready", supportedWalletApi: ["0.10.3"] })),
}));

vi.mock("./ready.ts", () => ({
  connectReady: mocks.connectReady,
  ensureReadyChain: vi.fn(),
}));

vi.mock("./public-deposit.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("./public-deposit.ts")>(),
  executeStarknetPublicDeposit: mocks.executeDeposit,
}));

import { WottaProductSession } from "./product-session";
import { buildEscrowClaimActions } from "./mainnet-privacy";

describe("Starknet escrow inbox flow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs quote → public escrow deposit → encrypted inbox note → private claim actions", async () => {
    const inbox = generateInboxKeyPair();
    const calls: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    let delivered: Record<string, unknown> | undefined;
    let intentId = "";
    const escrow = "0x789";
    const sourcePlan = {
      kind: "starknet_public_deposit" as const,
      usdc: "0x123",
      escrowPool: escrow,
      claimHash: "0x456",
      publicRefundRecipient: "0xabc",
      expiresAt: 4_102_444_800,
    };

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ path, method, body });
      if (path === "/v1/routes") return Response.json({
        chainId: "SN_MAIN",
        routes: [{ id: "starknet-private", enabled: true }],
        manifestHash: "a".repeat(64),
        pendingDeliveryPublicKey: "unused",
        escrows: [{ denomination: "1000000", address: escrow, classHash: "0x999" }],
      });
      if (path === "/v1/resolve") return Response.json({ descriptor: { registered: true, inboxEncryptionPublicKey: inbox.publicKey } });
      if (path === "/v1/intents" && method === "POST") {
        intentId = String(body?.id);
        return Response.json({ ok: true });
      }
      if (path === "/v1/quotes") return Response.json({ quote: { sourcePlan }, signature: "sig" });
      if (path.endsWith("/delivery")) { delivered = body; return Response.json({ ok: true }); }
      if (path.endsWith("/source-submitted")) return Response.json({ ok: true });
      if (path === `/v1/intents/${intentId}`) return Response.json({ id: intentId, state: "funded", onchain_state: "funded" });
      if (path === "/v1/session/sync") return Response.json({ ok: true });
      if (path === "/v1/notes") return Response.json({ chainId: "SN_MAIN", notes: [{
        id: "note-1",
        intent_id: intentId,
        ciphertext: delivered?.ciphertext,
        nonce: delivered?.nonce,
        sender_public_key: delivered?.ephemeralPublicKey,
        algorithm: delivered?.algorithm,
        intent: { onchain_state: "funded" },
      }] });
      if (path === "/v1/notes/note-1/delivered") return Response.json({ ok: true });
      return Response.json({ error: `unexpected ${method} ${path}` }, { status: 500 });
    }));

    const supabase = { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "token" } } })) } };
    const session = new WottaProductSession(supabase as never, {
      apiUrl: "https://api.example",
      network: "mainnet",
      supabaseUrl: "https://supabase.example",
      supabasePublishableKey: "publishable",
      solanaRpcUrl: "",
      stellarRpcUrl: "",
    });
    const result = await session.fundFromStarknetEscrow({
      denomination: "1000000",
      recipient: "recipient@example.com",
      publicRefundRecipient: "0xabc",
      linkedReadyAddress: "0xabc",
    });
    const claim = await session.loadClaim({ state: { inboxSecretKey: inbox.secretKey }, setInboxSecretKey: vi.fn() });

    expect(mocks.executeDeposit).toHaveBeenCalledWith(expect.objectContaining({ plan: sourcePlan, amount: 1_000_000n }));
    expect(calls.find((call) => call.path === "/v1/quotes")?.body).toMatchObject({ routeId: "starknet-private", mode: "private", deliveryKind: "registered" });
    expect(delivered).toMatchObject({ recipient: { provider: "email", identifier: "recipient@example.com" } });
    expect(claim).toMatchObject({ noteId: "note-1", intentId: result.intentId, claimSecret: result.claimSecret, escrow: { address: escrow, denomination: 1_000_000n } });
    expect(buildEscrowClaimActions("0x123", "0xabc", escrow, claim.claimSecret)).toEqual([
      expect.objectContaining({ type: "transfer", amount: "OPEN", recipient: "0xabc" }),
      expect.objectContaining({ type: "invoke", contract: escrow }),
    ]);
  });
});
