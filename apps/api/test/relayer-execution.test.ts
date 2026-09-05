import test from "node:test";
import assert from "node:assert/strict";
import { Account, RpcProvider } from "starknet";
import { CIRCLE_STARKNET_TOKEN_MESSENGER, CIRCLE_TESTNET_ROUTES } from "@wotta/adapters";
import { PROTOCOL_FIXTURES, encodeCircleCctpMessageV2ForTest } from "@wotta/shared";
import { loadConfig } from "../src/config.ts";
import { processJob } from "../src/relayer/run.ts";
import { resetIrisPollingStateForTest } from "../src/relayer/iris.ts";
import type { Db } from "../src/db/client.ts";
import type { Logger } from "pino";

function fixture(state: string, destination: string | null) {
  const config = loadConfig({
    SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example", RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32), PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    STARKNET_NETWORK: "sepolia", CCTP_ADMITTED_ROUTES: "base,solana",
    STARKNET_RELAYER_ADDRESS: "0x123", STARKNET_RELAYER_PRIVATE_KEY: "0x456",
  });
  const pool = config.manifest.pools.find(p => p.denomination === "1000000")!;
  const hook = { intentId: PROTOCOL_FIXTURES.hook.intentId, claimHash: PROTOCOL_FIXTURES.hook.claimHash, publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient, denominationCode: 0, escrowPool: pool.address, expiresAt: 1_735_689_600n, manifestVersion: 1 };
  const message = encodeCircleCctpMessageV2ForTest({ sourceDomain: 6, tokenMessenger: CIRCLE_STARKNET_TOKEN_MESSENGER.testnet, router: config.manifest.router.address, amount: 1_000_000n, burnToken: CIRCLE_TESTNET_ROUTES.base.usdc, maxFee: 0n, feeExecuted: 0n, minFinalityThreshold: 2000, finalityThresholdExecuted: 2000, hook });
  let intent: any = { id: hook.intentId, owner_id: "owner", state, version: 2, route_id: "base", denomination: "1000000", source_tx_hash: "0xabc", claim_hash: hook.claimHash, public_refund_recipient: hook.publicRefundRecipient, expires_at: new Date(Number(hook.expiresAt) * 1000).toISOString(), quote: { quote: { grossDebit: "1000000", maxFee: "0", minFinalityThreshold: 2000 } }, onchain_state: null, onchain_tx_hash: null };
  const job = { id: "job", attempts: 0, destination_tx_hash: destination, intent: { ...intent } };
  const updates: Record<string, unknown>[] = [];
  const states: string[] = [];
  const db = { from(table: string) {
    let value: Record<string, unknown> | undefined;
    const query: any = {
      select: () => query, eq: () => query,
      update: (v: Record<string, unknown>) => { value = v; return query; },
      maybeSingle: async () => {
        if (value && table === "intents") { intent = { ...intent, ...value }; if (value.state) states.push(String(value.state)); }
        return { data: { ...intent }, error: null };
      },
      insert: async () => ({ error: null }),
      then: (resolve: (v: unknown) => void) => { if (table === "relayer_jobs" && value) updates.push(value); resolve({ data: null, error: null }); },
    };
    return query;
  } } as unknown as Db;
  return { config, db, job, message: typeof message === "string" ? message : `0x${Buffer.from(message).toString("hex")}`, updates, states, intent };
}

test.afterEach(() => resetIrisPollingStateForTest());

test("a recoverable job without a destination hash attempts settlement instead of claiming funding", async t => {
  const f = fixture("failed_recoverable", null);
  t.mock.method(globalThis, "fetch", async () => Response.json({ messages: [{ message: f.message, attestation: "0x01", status: "complete" }] }));
  t.mock.method(RpcProvider.prototype, "callContract", async ({ entrypoint }: { entrypoint: string }) => entrypoint === "processed" ? ["0x0"] : ["100000000000000000000", "0"]);
  let attempted = false;
  t.mock.method(Account.prototype, "estimateInvokeFee", async () => { attempted = true; throw new Error("settlement unavailable"); });
  await assert.rejects(processJob({ db: f.db, config: f.config, log: { info() {}, warn() {} } as unknown as Logger }, f.job), /settlement unavailable/);
  assert.equal(attempted, true);
  assert.deepEqual(f.states, ["attestation_ready"]);
  assert.equal(f.updates.some(u => u.status === "succeeded"), false);
});

test("a finalized reverted settlement is cleared for retry and never reported funded", async t => {
  const f = fixture("destination_submitted", "0xbad");
  t.mock.method(globalThis, "fetch", async () => Response.json({ messages: [{ message: f.message, attestation: "0x01", status: "complete" }] }));
  t.mock.method(RpcProvider.prototype, "callContract", async () => ["100000000000000000000", "0"]);
  t.mock.method(RpcProvider.prototype, "waitForTransaction", async () => ({ isSuccess: () => false }));
  await assert.rejects(processJob({ db: f.db, config: f.config, log: { info() {}, warn() {} } as unknown as Logger }, f.job), /settlement_reverted/);
  assert.equal(f.job.destination_tx_hash, null);
  assert.deepEqual(f.states, ["failed_recoverable"]);
  assert.equal(f.updates.some(u => u.status === "succeeded"), false);
  assert.equal(f.updates.some(u => u.destination_tx_hash === null), true);
});

test("an indexed claim completes the job without another burn or settlement", async () => {
  const f = fixture("claimed", null);
  f.intent.onchain_state = "claimed";
  f.intent.onchain_tx_hash = "0xclaim";
  assert.equal(await processJob({ db: f.db, config: f.config, log: {} as Logger }, f.job), true);
  assert.equal(f.updates[0]?.status, "succeeded");
});
