import test from "node:test";
import assert from "node:assert/strict";
import { pathToward, recoveryHintFor } from "../src/intents/recovery.ts";

test("pathToward walks source_submitted to funded without illegal jumps", () => {
  assert.deepEqual(pathToward("source_submitted", "funded"), ["source_confirmed", "funded"]);
  assert.equal(pathToward("source_submitted", "funded").includes("attestation_ready"), false);
});

test("pathToward walks funded to claimed and refunded", () => {
  assert.deepEqual(pathToward("funded", "claimed"), ["claimable", "claimed"]);
  assert.deepEqual(pathToward("funded", "refunded"), ["expired", "refundable", "refunded"]);
  assert.deepEqual(pathToward("delivered", "claimed"), ["claimable", "claimed"]);
});

test("pathToward rejects unreachable targets", () => {
  assert.throws(() => pathToward("claimed", "funded"), /invalid_transition/);
});

test("recoveryHint surfaces self-settle after fifteen minutes", () => {
  const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  assert.equal(recoveryHintFor({ state: "attestation_ready", updated_at: old }), "self_settle");
  assert.equal(recoveryHintFor({ state: "source_submitted", updated_at: old }), "awaiting_attestation");
  assert.equal(recoveryHintFor({ state: "failed_recoverable" }), "failed_recoverable");
  assert.equal(recoveryHintFor({ state: "funded", onchain_state: "funded" }), "awaiting_claim");
  assert.equal(recoveryHintFor({ state: "quoted", route_id: "starknet-public" }), "none");
});

test("recoveryHint exposes an exhausted relayer job instead of claiming it is settling", () => {
  assert.equal(recoveryHintFor({
    state: "attestation_ready",
    route_id: "base",
    jobStatus: "failed",
    updated_at: new Date().toISOString(),
  }), "failed_recoverable");
});
