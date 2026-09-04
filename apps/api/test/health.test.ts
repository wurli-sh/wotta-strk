import test from "node:test";
import assert from "node:assert/strict";
import { healthBody } from "../src/relayer/health.ts";
import { loadConfig } from "../src/config.ts";

test("health body includes queue fields without STRK secrets", () => {
  const config = loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example",
    RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32),
    PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    STARKNET_NETWORK: "sepolia",
  });
  const body = healthBody(config, 2, {
    relayerQueued: 3,
    oldestQueuedAgeSec: 120,
    relayerFailed: 1,
    strkAlert: null,
  });
  assert.equal(body.relayerQueued, 3);
  assert.equal(body.oldestQueuedAgeSec, 120);
  assert.equal(body.relayerFailed, 1);
  assert.equal(body.strkAlert, null);
  assert.equal("address" in body, false);
  assert.equal(JSON.stringify(body).includes("wei"), false);
});
