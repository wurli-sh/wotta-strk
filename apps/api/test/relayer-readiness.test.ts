import test from "node:test";
import assert from "node:assert/strict";
import type { RpcProvider } from "starknet";
import { loadConfig } from "../src/config.ts";
import { assertRelayerReadyForBurn, resolveRelayerCredentials } from "../src/relayer/readiness.ts";

const baseEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a".repeat(32),
  STARKNET_RPC_URL: "https://rpc.example",
  RESOLVER_SIGNING_KEY: "b".repeat(32),
  IDENTITY_LOOKUP_KEY: "c".repeat(32),
  PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  STARKNET_RELAYER_ADDRESS: "0x123",
};

test("Sepolia quote readiness validates its relayer before allowing a burn", async () => {
  const config = loadConfig({ ...baseEnv, STARKNET_NETWORK: "sepolia" });
  let reads = 0;
  await assert.doesNotReject(() => assertRelayerReadyForBurn(config, async () => { reads += 1; return { balance: config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI }; }));
  assert.equal(reads, 1);
  await assert.rejects(
    () => assertRelayerReadyForBurn(config, async () => { throw new Error("relayer_account_not_deployed"); }),
    /relayer_account_not_deployed/,
  );
});

test("Mainnet quote readiness fails before burn below the configured STRK floor", async () => {
  const config = loadConfig({
    ...baseEnv,
    STARKNET_NETWORK: "mainnet",
  });
  await assert.rejects(
    () => assertRelayerReadyForBurn(config, async () => ({ balance: config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI - 1n })),
    /relayer_strk_balance_low/,
  );
  await assert.doesNotReject(
    () => assertRelayerReadyForBurn(config, async () => ({ balance: config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI })),
  );
});

test("Sepolia falls back to a deployed local account when its relayer override is stale", async () => {
  const config = loadConfig({
    ...baseEnv,
    STARKNET_NETWORK: "sepolia",
    STARKNET_RELAYER_PRIVATE_KEY: "0x456",
    STARKNET_DEPLOYER_ADDRESS: "0x789",
    STARKNET_DEPLOYER_PRIVATE_KEY: "0xabc",
  });
  const checked: string[] = [];
  const provider = {
    async getClassHashAt(address: string) {
      checked.push(address);
      if (address === "0x123") throw new Error("20: Contract not found");
      return "0xclass";
    },
  } as unknown as RpcProvider;
  const credentials = await resolveRelayerCredentials(config, provider);
  assert.equal(credentials.source, "deployer");
  assert.equal(credentials.address, "0x789");
  assert.deepEqual(checked, ["0x123", "0x789"]);
});
