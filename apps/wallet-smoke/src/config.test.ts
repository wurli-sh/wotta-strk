import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHelperConfigured,
  CIRCLE_SEPOLIA_USDC,
  loadSmokeConfig,
  requireDirectPrivacy,
  type SmokeEnv,
  type SmokeManifest,
} from "./config.ts";

const MANIFEST: SmokeManifest = {
  version: 1,
  chainId: "SN_MAIN",
  usdc: "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb",
  strk20Pool:
    "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  strk20ClassHash: "0xabc",
};

const BASE_ENV: SmokeEnv = {
  STARKNET_RPC_URL: "https://example.rpc/rpc",
  VITE_STARKNET_RPC_URL: "https://example.rpc/rpc",
};

test("loadSmokeConfig requires an RPC URL", () => {
  assert.throws(
    () => loadSmokeConfig({}, MANIFEST),
    /STARKNET_RPC_URL|VITE_STARKNET_RPC_URL/,
  );
});

test("loadSmokeConfig supports a Sepolia manifest", () => {
  const config = loadSmokeConfig(BASE_ENV, {
    ...MANIFEST,
    chainId: "SN_SEPOLIA",
  });
  assert.equal(config.chainId, "SN_SEPOLIA");
  assert.equal(config.readyUsdc, CIRCLE_SEPOLIA_USDC);
});

test("loadSmokeConfig selects a verified direct Privacy SDK route", () => {
  const config = loadSmokeConfig(BASE_ENV, {
    ...MANIFEST,
    chainId: "SN_SEPOLIA",
    directPrivacy: {
      status: "verified",
      source: "test",
      poolAddress: "0x254",
      poolClassHash: "0x56a",
      identityClassHash: "0x17b",
      usdc: CIRCLE_SEPOLIA_USDC,
      proverUpstream: "https://prover.example",
      discoveryUpstream: "https://discovery.example",
    },
  });
  const direct = requireDirectPrivacy(config);
  assert.equal(direct.poolAddress, "0x254");
  assert.equal(direct.usdc, CIRCLE_SEPOLIA_USDC);
  assert.equal(direct.proverPath, "/privacy/prover");
});

test("loadSmokeConfig enables only a verified direct Privacy SDK escrow", () => {
  const config = loadSmokeConfig(BASE_ENV, {
    ...MANIFEST,
    chainId: "SN_SEPOLIA",
    directPrivacy: {
      status: "verified",
      source: "test",
      poolAddress: "0x254",
      poolClassHash: "0x56a",
      identityClassHash: "0x17b",
      usdc: CIRCLE_SEPOLIA_USDC,
      proverUpstream: "https://prover.example",
      discoveryUpstream: "https://discovery.example",
      escrow: {
        status: "verified",
        address: "0x987",
        classHash: "0x654",
        denomination: "1000000",
        deploymentTxHash: "0x123",
        deployedBlock: 42,
        verificationNotes: "getter checks passed",
      },
    },
  });
  assert.equal(requireDirectPrivacy(config).escrow?.address, "0x987");
  assert.equal(requireDirectPrivacy(config).escrow?.denomination, 1_000_000n);
});

test("direct Privacy SDK route fails closed outside Sepolia", () => {
  const config = loadSmokeConfig(BASE_ENV, MANIFEST);
  assert.throws(() => requireDirectPrivacy(config), /only for Sepolia/);
});

test("loadSmokeConfig pins USDC and STRK20 pool from the manifest", () => {
  const config = loadSmokeConfig(BASE_ENV, MANIFEST);
  assert.equal(config.chainId, "SN_MAIN");
  assert.equal(config.usdc, MANIFEST.usdc);
  assert.equal(config.readyUsdc, MANIFEST.usdc);
  assert.equal(config.strk20Pool, MANIFEST.strk20Pool);
  assert.equal(config.strk20ClassHash, "0xabc");
  assert.equal(config.rpcUrl, "https://example.rpc/rpc");
  assert.match(config.manifestHash, /^[a-f0-9]{64}$/);
});

test("loadSmokeConfig supports an explicit Ready-route USDC", () => {
  const readyUsdc = "0x512";
  const config = loadSmokeConfig(
    { ...BASE_ENV, VITE_READY_USDC_ADDRESS: readyUsdc },
    MANIFEST,
  );
  assert.equal(config.readyUsdc, readyUsdc);
  assert.equal(config.usdc, MANIFEST.usdc);
});

test("assertHelperConfigured fails closed without a helper address", () => {
  const config = loadSmokeConfig(BASE_ENV, MANIFEST);
  assert.throws(() => assertHelperConfigured(config), /helper/i);
});

test("assertHelperConfigured accepts a felt address", () => {
  const config = loadSmokeConfig(
    {
      ...BASE_ENV,
      VITE_HELPER_ADDRESS:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    MANIFEST,
  );
  assert.equal(
    assertHelperConfigured(config),
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
});
