import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DENOMINATIONS,
  STARKNET_JS_VERSION,
  WOTTA_WORKSPACE_VERSION,
  deploymentManifestSchema,
  hashDeploymentManifest,
  identifierSchema,
} from "./index.ts";

test("workspace scaffold exports version", () => {
  assert.equal(WOTTA_WORKSPACE_VERSION, "0.0.0");
});

test("starknet.js pin is recorded", () => {
  assert.equal(STARKNET_JS_VERSION, "10.5.0");
});

test("recipient identifiers accept canonical email and X namespaces", () => {
  assert.equal(identifierSchema.parse({ provider: "email", identifier: "user@example.com" }).provider, "email");
  assert.equal(identifierSchema.parse({ provider: "x", identifier: "@user" }).provider, "x");
});

test("deployment manifest schema accepts four pool placeholders", () => {
  const parsed = deploymentManifestSchema.parse({
    version: 1,
    chainId: "SN_MAIN",
    network: "mainnet",
    rpcUrlEnv: "STARKNET_RPC_URL",
    manifestHash: "PENDING",
    generatedAt: "PENDING",
    verified: false,
    verificationNotes: "pending verification",
    usdc: "0x1",
    strk20Pool: "0x2",
    router: {
      classHash: "UNDECLARED",
      address: "UNDEPLOYED",
      declareTxHash: "PENDING",
      deployTxHash: "PENDING",
      deployedBlock: "PENDING",
      constructorCalldata: [],
      verification: {
        status: "pending",
        checkedAt: "PENDING",
        notes: "pending",
      },
    },
    pools: DENOMINATIONS.map((denomination, index) => ({
      key: ["pool1", "pool10", "pool50", "pool100"][index],
      denomination,
      classHash: "UNDECLARED",
      address: "UNDEPLOYED",
      declareTxHash: "PENDING",
      deployTxHash: "PENDING",
      deployedBlock: "PENDING",
      constructorCalldata: [],
      verification: {
        status: "pending",
        checkedAt: "PENDING",
        notes: "pending",
      },
    })),
  });
  assert.equal(parsed.pools.length, 4);
  assert.equal(parsed.router.address, "UNDEPLOYED");
});

test("deployment manifest hash returns sha256 hex", () => {
  const digest = hashDeploymentManifest({
    version: 1,
    chainId: "SN_MAIN",
    network: "mainnet",
    rpcUrlEnv: "STARKNET_RPC_URL",
    generatedAt: "PENDING",
    verified: false,
    verificationNotes: "pending verification",
    usdc: "0x1",
    strk20Pool: "0x2",
    strk20ClassHash: "UNKNOWN",
    deployer: {
      address: "UNKNOWN",
      keySource: "env:STARKNET_DEPLOYER_PRIVATE_KEY",
    },
    tooling: {
      starknetJs: "10.5.0",
      walletApiSchema: "0.10.3",
      scarb: "2.17.0",
      snforge: "0.59.0",
    },
    router: {
      classHash: "UNDECLARED",
      address: "UNDEPLOYED",
      declareTxHash: "PENDING",
      deployTxHash: "PENDING",
      deployedBlock: "PENDING",
      constructorCalldata: [],
      verification: {
        status: "pending",
        checkedAt: "PENDING",
        notes: "pending",
      },
    },
    pools: [
      "pool1",
      "pool10",
      "pool50",
      "pool100",
    ].map((key, index) => ({
      key: key as "pool1" | "pool10" | "pool50" | "pool100",
      denomination: DENOMINATIONS[index]!,
      classHash: "UNDECLARED",
      address: "UNDEPLOYED",
      declareTxHash: "PENDING",
      deployTxHash: "PENDING",
      deployedBlock: "PENDING",
      constructorCalldata: [],
      verification: {
        status: "pending",
        checkedAt: "PENDING",
        notes: "pending",
      },
    })),
    evidence: {
      root: "evidence",
      walletSmokeFlow: "phase1-wallet-api",
      liveSmokeFlow: "phase1-live-smoke",
    },
  });
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test("deployment manifest accepts a verified direct Sepolia privacy route", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../../deployments/sepolia.json", import.meta.url), "utf8"),
  );
  const parsed = deploymentManifestSchema.parse(manifest);
  assert.equal(parsed.directPrivacy?.status, "verified");
  assert.match(parsed.directPrivacy?.poolAddress ?? "", /^0x/);
});
