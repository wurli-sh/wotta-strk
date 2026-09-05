import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { buildServer } from "../src/server.ts";

function testConfig() {
  return loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example",
    RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32),
    PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    STARKNET_NETWORK: "sepolia",
  });
}

test("every API route rejects a browser request scoped to the other network", async () => {
  const config = testConfig();
  const app = await buildServer({ config, db: {} as never, log: createLogger(config) });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/routes",
      headers: { "x-wotta-network": "mainnet" },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "network_mode_mismatch");
  } finally {
    await app.close();
  }
});

test("matching network requests still reach the route", async () => {
  const config = testConfig();
  const app = await buildServer({ config, db: {} as never, log: createLogger(config) });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/routes",
      headers: { "x-wotta-network": "testnet" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().chainId, "SN_SEPOLIA");
  } finally {
    await app.close();
  }
});
