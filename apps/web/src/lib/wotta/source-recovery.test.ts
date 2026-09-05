import { afterEach, describe, expect, it, vi } from "vitest";
import { generateInboxKeyPair } from "@wotta/crypto";

const mocks = vi.hoisted(() => ({ burn: vi.fn(), deposit: vi.fn() }));
vi.mock("@wotta/adapters", async (original) => ({
  ...await original<typeof import("@wotta/adapters")>(),
  connectEvmSource: async () => "0xabc",
  connectSolanaSource: async () => "solana-owner",
  executeEvmCctpBurn: mocks.burn,
  executeSolanaCctpBurn: mocks.burn,
}));
vi.mock("./ready.ts", () => ({ connectReady: async () => ({ address: "0xabc", account: {} }), ensureReadyChain: vi.fn() }));
vi.mock("../wallet-install.ts", () => ({ requireSourceWallet: async () => {} }));
vi.mock("./public-deposit.ts", async (original) => ({
  ...await original<typeof import("./public-deposit.ts")>(), executeStarknetPublicDeposit: mocks.deposit,
}));
import { WottaProductSession } from "./product-session";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe.each(["base", "solana", "starknet-private"] as const)("%s source recovery", (route) => {
  it("records a broadcast and exposes its hash before a source RPC confirmation timeout", async () => {
    const inbox = generateInboxKeyPair();
    const order: string[] = [];
    const submitted: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/v1/routes") return Response.json({ routes: [{ id: route, enabled: true }], router: "0x123", escrows: [{ denomination: "100000", address: "0x789", classHash: "0x999" }] });
      if (path === "/v1/resolve") return Response.json({ descriptor: { registered: true, inboxEncryptionPublicKey: inbox.publicKey } });
      if (path === "/v1/quotes") return Response.json({ quote: { sourcePlan: { kind: "starknet_public_deposit", usdc: "0x123", escrowPool: "0x789", claimHash: "0x456", publicRefundRecipient: "0xabc", expiresAt: 4_102_444_800 } } });
      if (path.endsWith("/delivery")) order.push("delivery");
      if (path.endsWith("/source-submitted")) { order.push("record"); submitted.push(JSON.parse(String(init?.body))); }
      return Response.json({ ok: true });
    }));
    const execute = async ({ onSubmitted }: { onSubmitted: (hash: string) => Promise<void> }) => {
      order.push("broadcast");
      await onSubmitted("source-hash");
      order.push("confirmation");
      throw new Error("source RPC timed out");
    };
    mocks.burn.mockImplementation(execute);
    mocks.deposit.mockImplementation(execute);
    const session = new WottaProductSession({ auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } } as never, {
      apiUrl: "https://api.example", network: "mainnet", supabaseUrl: "https://supabase.example", supabasePublishableKey: "key", solanaRpcUrl: "https://solana.example", stellarRpcUrl: "",
    });
    const input = { denomination: "100000" as const, recipient: "recipient@example.com", publicRefundRecipient: "0xabc", onSourceTxHash: () => { order.push("visible"); } };
    const send = route === "starknet-private"
      ? session.fundFromStarknetEscrow({ ...input, linkedReadyAddress: "0xabc" })
      : session.fundFromCircleSource({ ...input, route });
    await expect(send).rejects.toThrow("source RPC timed out");
    expect(order).toEqual(["delivery", "broadcast", "visible", "record", "confirmation"]);
    expect(submitted).toEqual([{ expectedVersion: 1, txHash: "source-hash" }]);
  });
});

it("recognizes an escrow already claimed while the sender was waiting", async () => {
  const session = new WottaProductSession({} as never, {} as never);
  vi.spyOn(session, "intent").mockResolvedValue({ id: "intent", state: "claimed", onchain_state: "claimed" });
  await expect(session.waitForEscrow("intent")).resolves.toMatchObject({ state: "claimed" });
});
