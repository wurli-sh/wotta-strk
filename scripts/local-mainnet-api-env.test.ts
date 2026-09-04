import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocalMainnetApiUrl,
  localMainnetApiEnv,
} from "./local-mainnet-api-env.ts";

test("detects only the local :8788 mainnet API origins", () => {
  assert.equal(isLocalMainnetApiUrl("http://127.0.0.1:8788"), true);
  assert.equal(isLocalMainnetApiUrl("http://127.0.0.1:8788/"), true);
  assert.equal(isLocalMainnetApiUrl("http://localhost:8788"), true);
  assert.equal(isLocalMainnetApiUrl("https://wotta-api-mainnet.onrender.com"), false);
  assert.equal(isLocalMainnetApiUrl(undefined), false);
});

test("local mainnet API env stays closed and isolated from Sepolia admissions", () => {
  const env = localMainnetApiEnv({
    mainnetRpcUrl: "https://starknet-rpc.publicnode.com",
    cwd: "/repo",
  });

  assert.equal(env.STARKNET_NETWORK, "mainnet");
  assert.equal(env.STARKNET_RPC_URL, "https://starknet-rpc.publicnode.com");
  assert.equal(env.DEPLOYMENT_MANIFEST_PATH, "/repo/deployments/mainnet.json");
  assert.equal(env.PORT, "8788");
  assert.equal(env.API_ORIGIN, "http://127.0.0.1:8788");
  assert.equal(env.CCTP_ADMITTED_ROUTES, "");
  assert.equal(env.STARKNET_PRIVATE_ADMITTED, "false");
  assert.equal(env.RUN_INDEXER, "false");
  assert.equal(env.RUN_RELAYER, "false");
  assert.equal(env.CIRCLE_IRIS_BASE_URL, "https://iris-api.circle.com");
});
