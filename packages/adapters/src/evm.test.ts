import assert from "node:assert/strict";
import test from "node:test";
import { buildEvmCctpBurnCalls } from "./index.ts";
import { executeEvmCctpBurn } from "./evm.ts";

const owner = `0x${"12".repeat(20)}`;
const hash = `0x${"34".repeat(32)}`;
const plan = buildEvmCctpBurnCalls({ env: "mainnet", route: "base", router: "0x123", amount: 100_000n, hook: {
  intentId: "123e4567-e89b-42d3-a456-426614174000", denominationCode: 0, escrowPool: "0x456", claimHash: "0x789", publicRefundRecipient: "0xabc", expiresAt: 1_800_000_000n, manifestVersion: 1,
} });

function provider(options: { switched?: boolean; onConfirm?: () => void } = {}) {
  let chainReads = 0;
  let sends = 0;
  return { sends: () => sends, request: async ({ method }: { method: string }) => {
    if (method === "eth_chainId") return options.switched && chainReads++ > 0 ? "0x1" : "0x2105";
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [owner];
    if (method === "eth_call") return `0x${(1_000_000n).toString(16).padStart(64, "0")}`;
    if (method === "eth_estimateGas") return "0x10000";
    if (method === "eth_sendTransaction") { sends++; return hash; }
    if (method === "eth_getTransactionReceipt") { options.onConfirm?.(); throw new Error("RPC unavailable"); }
    throw new Error(`unexpected ${method}`);
  } };
}

test("Base publishes its burn hash before a confirmation RPC failure", async () => {
  let recorded = "";
  const wallet = provider({ onConfirm: () => assert.equal(recorded, hash) });
  await assert.rejects(executeEvmCctpBurn({ plan, provider: wallet, onSubmitted: async tx => { recorded = tx; } }), /RPC unavailable/);
  assert.equal(recorded, hash);
  assert.equal(wallet.sends(), 1);
});

test("Base rejects a network switch before burning", async () => {
  const wallet = provider({ switched: true });
  await assert.rejects(executeEvmCctpBurn({ plan, provider: wallet }), /network changed/);
  assert.equal(wallet.sends(), 0);
});
