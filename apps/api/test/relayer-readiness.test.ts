import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { assertRelayerReadyForBurn } from "../src/relayer/readiness.ts";

const baseEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a".repeat(32),
  STARKNET_RPC_URL: "https://rpc.example",
  RESOLVER_SIGNING_KEY: "b".repeat(32),
  IDENTITY_LOOKUP_KEY: "c".repeat(32),
  PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  STARKNET_RELAYER_ADDRESS: "0x123",
};

test("Sepolia quote readiness does not require a Mainnet relayer balance", async () => {
  const config = loadConfig({ ...baseEnv, STARKNET_NETWORK: "sepolia" });
  let reads = 0;
  await assert.doesNotReject(() => assertRelayerReadyForBurn(config, async () => { reads += 1; return 0n; }));
  assert.equal(reads, 0);
});

test("Mainnet quote readiness fails before burn below the configured STRK floor", async () => {
  const config = loadConfig({
    ...baseEnv,
    STARKNET_NETWORK: "mainnet",
  });
  await assert.rejects(
    () => assertRelayerReadyForBurn(config, async () => config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI - 1n),
    /relayer_strk_balance_low/,
  );
  await assert.doesNotReject(
    () => assertRelayerReadyForBurn(config, async () => config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI),
  );
});
