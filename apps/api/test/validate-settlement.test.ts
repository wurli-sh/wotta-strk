import test from "node:test";
import assert from "node:assert/strict";
import { CIRCLE_TESTNET_ROUTES } from "@wotta/adapters";
import { PROTOCOL_FIXTURES, encodeCircleCctpMessageV2ForTest } from "@wotta/shared";
import { loadConfig } from "../src/config.ts";
import { validateSettlement, type SettlementJob } from "../src/relayer/validate-settlement.ts";

const sepoliaEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a".repeat(32),
  STARKNET_RPC_URL: "https://rpc.example",
  RESOLVER_SIGNING_KEY: "b".repeat(32),
  IDENTITY_LOOKUP_KEY: "c".repeat(32),
  PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  STARKNET_NETWORK: "sepolia",
  CCTP_ADMITTED_ROUTES: "base",
};

function fixture() {
  const config = loadConfig(sepoliaEnv);
  const pool = config.manifest.pools.find((candidate) => candidate.denomination === "1000000");
  if (!pool) throw new Error("missing 1 USDC pool");
  const expiresAtUnix = 1_735_689_600n;
  const expiresAt = new Date(Number(expiresAtUnix) * 1000).toISOString();
  const hook = {
    intentId: PROTOCOL_FIXTURES.hook.intentId,
    denominationCode: 0,
    escrowPool: pool.address,
    claimHash: PROTOCOL_FIXTURES.hook.claimHash,
    publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
    expiresAt: expiresAtUnix,
    manifestVersion: 1,
  };
  const circle = CIRCLE_TESTNET_ROUTES.base;
  const encode = (overrides: Partial<Parameters<typeof encodeCircleCctpMessageV2ForTest>[0]> = {}) =>
    encodeCircleCctpMessageV2ForTest({
      sourceDomain: 6,
      tokenMessenger: circle.tokenMessenger,
      router: config.manifest.router.address,
      amount: 1_000_000n,
      burnToken: circle.usdc,
      maxFee: 0n,
      feeExecuted: 0n,
      minFinalityThreshold: 2000,
      finalityThresholdExecuted: 2000,
      hook,
      ...overrides,
    });
  const job: SettlementJob = {
    intent: {
      id: PROTOCOL_FIXTURES.hook.intentId,
      state: "source_submitted",
      route_id: "base",
      denomination: "1000000",
      claim_hash: PROTOCOL_FIXTURES.hook.claimHash,
      public_refund_recipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
      expires_at: expiresAt,
      quote: {
        quote: {
          grossDebit: "1000000",
          maxFee: "0",
          minFinalityThreshold: 2000,
        },
      },
    },
  };
  return { config, encode, job, hook, circle, pool };
}

test("valid Base settlement message is accepted", () => {
  const { config, encode, job } = fixture();
  const decoded = validateSettlement(config, job, encode());
  assert.equal(decoded.sourceDomain, 6);
  assert.equal(decoded.wrapper.hook.intentId, job.intent.id);
});

test("mutated settlement fields are rejected independently", () => {
  const { config, encode, job, hook, circle, pool } = fixture();

  assert.throws(() => validateSettlement(config, job, encode({ sourceDomain: 5 })), /settlement_source_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ destinationDomain: 24 })), /settlement_destination_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ destinationCaller: "0xbad" })), /settlement_router_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ mintRecipient: "0xbad" })), /settlement_router_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ tokenMessenger: "0xbad" })), /settlement_recipient_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ burnToken: "0x1" })), /settlement_burn_token_mismatch/);
  assert.throws(
    () => validateSettlement(config, { ...job, intent: { ...job.intent, id: "00000000-0000-4000-8000-000000000000" } }, encode()),
    /settlement_intent_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, escrowPool: "0x1" } })),
    /settlement_pool_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, denominationCode: 1 } })),
    /settlement_denomination_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, claimHash: "0x1" } })),
    /settlement_claim_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, publicRefundRecipient: "0x1" } })),
    /settlement_refund_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, expiresAt: 1n } })),
    /settlement_expiry_mismatch/,
  );
  assert.throws(
    () => validateSettlement(config, job, encode({ hook: { ...hook, manifestVersion: 2 } })),
    /settlement_manifest_mismatch/,
  );
  assert.throws(() => validateSettlement(config, job, encode({ amount: 2_000_000n })), /settlement_fee_binding_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ maxFee: 1n })), /settlement_fee_binding_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ feeExecuted: 1n })), /settlement_underfunded/);
  assert.throws(() => validateSettlement(config, job, encode({ minFinalityThreshold: 1000 })), /settlement_finality_mismatch/);
  assert.throws(() => validateSettlement(config, job, encode({ finalityThresholdExecuted: 1000 })), /settlement_finality_mismatch/);
  assert.ok(circle.tokenMessenger);
  assert.ok(pool.address);
});
