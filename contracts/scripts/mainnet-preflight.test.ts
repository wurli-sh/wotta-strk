import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
} from "../../packages/shared/src/index.ts";
import {
  assertMainnetDeployerIdentity,
  assertMainnetDeployConfig,
  assertMainnetManifest,
  syncMainnetPilotIdentities,
} from "./mainnet-preflight.ts";
import {
  assertBalanceCoversBounds,
  assertDeclareWithinCeiling,
  maxFeeForBounds,
  STRK_FRI,
} from "./mainnet-rpc.ts";

async function manifest() {
  return deploymentManifestSchema.parse(JSON.parse(await readFile(
    new URL("../../deployments/mainnet.json", import.meta.url),
    "utf8",
  )));
}

test("declaration preflight checks manifest facts, not launch policy", async () => {
  const value = await manifest();
  assert.doesNotThrow(() => assertMainnetManifest(value));

  const stale = { ...value, generatedAt: new Date(0).toISOString() };
  assert.throws(() => assertMainnetManifest(stale), /deployment_manifest_hash_mismatch/);
});

test("deploy config requires only concrete constructor inputs", async () => {
  const source = await manifest();
  const value = {
    ...source,
    router: { ...source.router, classHash: "0x123", declareTxHash: "0x456" },
    pools: source.pools.map((pool) => source.approvedCctpDenominations.includes(pool.denomination)
      ? { ...pool, classHash: "0x789", declareTxHash: "0xabc" }
      : pool),
  };
  value.manifestHash = rehashDeploymentManifest(value);
  assert.doesNotThrow(() => assertMainnetDeployConfig(value));

  const openOwner = { ...value, authority: { ...value.authority, owner: "PENDING" } };
  openOwner.manifestHash = rehashDeploymentManifest(openOwner);
  assert.throws(() => assertMainnetDeployConfig(openOwner), /authority_owner_open/);
  assert.throws(() => assertMainnetDeployConfig(source), /router_declaration_missing/);
});

test("pilot sync forces owner to equal deployer from env", async () => {
  const value = await manifest();
  const synced = syncMainnetPilotIdentities(value, {
    STARKNET_MAINNET_DEPLOYER_ADDRESS: "0xabc",
  });
  assert.equal(synced.deployer.address.toLowerCase(), "0xabc");
  assert.equal(synced.authority.owner.toLowerCase(), "0xabc");

  const mismatched = {
    ...synced,
    router: { ...synced.router, classHash: "0x1", declareTxHash: "0x2" },
    pools: synced.pools.map((pool) => synced.approvedCctpDenominations.includes(pool.denomination)
      ? { ...pool, classHash: "0x3", declareTxHash: "0x4" }
      : pool),
    deployer: { ...synced.deployer, address: "0xabc" },
    authority: { ...synced.authority, owner: "0xdef" },
  };
  mismatched.manifestHash = rehashDeploymentManifest(mismatched);
  assert.throws(() => assertMainnetDeployConfig(mismatched), /pilot_owner_must_match_deployer/);
});

test("declaration needs no relayer identity but rejects Sepolia deployer reuse", () => {
  const env = {
    STARKNET_MAINNET_DEPLOYER_ADDRESS: "0x123",
    STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY: "0x456",
  };
  assert.doesNotThrow(() => assertMainnetDeployerIdentity(env, "0x999"));
  assert.throws(
    () => assertMainnetDeployerIdentity(env, "0x123"),
    /mainnet_identity_reuses_sepolia_identity/,
  );
});

test("fee helpers cap each declaration and require balance for both bounds", () => {
  assert.doesNotThrow(() => assertDeclareWithinCeiling("router", 45n * STRK_FRI));
  assert.throws(
    () => assertDeclareWithinCeiling("router", 45n * STRK_FRI + 1n),
    /router_declare_bound_exceeds_ceiling/,
  );
  assert.doesNotThrow(() => assertBalanceCoversBounds(80n, [45n, 35n]));
  assert.throws(() => assertBalanceCoversBounds(79n, [45n, 35n]), /balance_below_declare_bounds/);
  assert.equal(maxFeeForBounds({
    l1_gas: { max_amount: 2n, max_price_per_unit: 3n },
    l1_data_gas: { max_amount: 5n, max_price_per_unit: 7n },
    l2_gas: { max_amount: 11n, max_price_per_unit: 13n },
  }), 184n);
});
