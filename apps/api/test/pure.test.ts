import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIdentifier } from "../src/auth/normalize.ts";
import { assertCctpPilotControls, assertStarknetPrivateEscrowIntent, buildStarknetEscrowDepositPlan, cctpFinalityThreshold, quoteMatchesStoredIntent, sameFelt, sameInstant, transitionAllowed } from "../src/intents/service.ts";
import { ROUTES, routesForConfig, starknetEscrowInboxReady, verifiedEscrowPoolsForConfig } from "../src/routes.ts";
import { assertMainnetFallbackRpcNetwork, assertMainnetSourceRpcNetworks, assertMainnetWorkerReadiness, loadConfig } from "../src/config.ts";
import { collectVerifiedIdentities } from "../src/auth/sync.ts";
import { decodeEscrowProjection, indexedDeploymentStart, indexedEscrowAddresses } from "../src/indexer/run.ts";
import { hash } from "starknet";
import { safeError } from "../src/logger.ts";
import { requireWalletOrigin, walletBindingTypedData, normalizeWalletAddress } from "../src/auth/challenge.ts";
import { requestChainId } from "../src/network-scope.ts";

test("identity normalization rejects unverified-shaped inputs", () => { assert.equal(normalizeIdentifier("x", "@Wotta_User"), "wotta_user"); assert.equal(normalizeIdentifier("google", "User@Example.COM"), "user@example.com"); assert.equal(normalizeIdentifier("email", "User@Example.COM"), "user@example.com"); assert.throws(() => normalizeIdentifier("x", "not valid")); });
test("X-only OAuth registers both its verified handle and email", () => {
  assert.deepEqual(collectVerifiedIdentities({
    id: "profile-x",
    email: "Alice@Example.com",
    email_confirmed_at: "2026-08-21T00:00:00.000Z",
    identities: [{ id: "x-subject", provider: "x", identity_data: { preferred_username: "Alice_X", email: "Alice@Example.com" } }],
  }), [
    { provider: "x", providerSubject: "x-subject", normalizedIdentifier: "alice_x" },
    { provider: "email", providerSubject: "x-email:x-subject", normalizedIdentifier: "alice@example.com" },
  ]);
});
test("linking X to Google never claims the Google email as X-owned", () => {
  assert.deepEqual(collectVerifiedIdentities({
    id: "profile-linked",
    email: "google@example.com",
    email_confirmed_at: "2026-08-21T00:00:00.000Z",
    identities: [
      { id: "google-subject", provider: "google", identity_data: { email: "google@example.com", email_verified: true } },
      { id: "x-subject", provider: "x", identity_data: { user_name: "linked_x" } },
    ],
  }), [
    { provider: "google", providerSubject: "google-subject", normalizedIdentifier: "google@example.com" },
    { provider: "x", providerSubject: "x-subject", normalizedIdentifier: "linked_x" },
  ]);
});
test("intent state machine permits no terminal escape", () => { assert.equal(transitionAllowed("quoted", "source_submitted"), true); assert.equal(transitionAllowed("claimed", "refunded"), false); assert.equal(transitionAllowed("expired", "claimed"), false); });
test("quote matching tolerates timestamptz and felt padding", () => {
  assert.equal(sameInstant("2026-08-28T18:18:22.821Z", "2026-08-28T18:18:22.821+00:00"), true);
  assert.equal(sameFelt("0x0abc", "0xABC"), true);
  assert.equal(quoteMatchesStoredIntent({
    route_id: "base",
    denomination: 1_000_000,
    claim_hash: "0x0abc",
    public_refund_recipient: "0x07b54db60f62d919197e17347f0e05e0dfc2ba1ce6cd5e5f992b4d95690c90d0",
    expires_at: "2026-08-28T18:18:22.821+00:00",
  }, {
    routeId: "base",
    denomination: "1000000",
    claimHash: "0xabc",
    publicRefundRecipient: "0x7b54db60f62d919197e17347f0e05e0dfc2ba1ce6cd5e5f992b4d95690c90d0",
    expiresAt: "2026-08-28T18:18:22.821Z",
  }), true);
});
test("escrow event projection derives funded state from canonical public fields", () => {
  assert.deepEqual(decodeEscrowProjection({
    keys: [hash.getSelectorFromName("RouterFunded")],
    data: ["0x123", "0xf4240", "0x100"],
  }), {
    kind: "funded",
    claimHash: "0x123",
    denomination: "1000000",
    payload: { expiresAt: "256" },
  });
});
test("unverified route manifest is fail closed", () => { assert.equal(ROUTES.every((route) => !route.enabled), true); });
test("verified Sepolia destination admits Starknet publicly but CCTP per route", () => {
  const base = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example",
    RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32),
    PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    STARKNET_NETWORK: "sepolia",
  };
  const closed = routesForConfig(loadConfig(base));
  assert.equal(closed.find((route) => route.id === "starknet-public")?.enabled, true);
  assert.equal(closed.find((route) => route.id === "starknet-private")?.enabled, true);
  assert.equal(closed.find((route) => route.id === "base")?.enabled, false);
  assert.equal(closed.find((route) => route.id === "ethereum")?.enabled, false);
  assert.equal(closed.find((route) => route.id === "solana")?.enabled, false);
  const baseOnly = routesForConfig(loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "base" }));
  assert.equal(baseOnly.find((route) => route.id === "base")?.enabled, true);
  assert.equal(baseOnly.find((route) => route.id === "ethereum")?.enabled, false);
  const allCctp = routesForConfig(loadConfig({
    ...base,
    CCTP_ADMITTED_ROUTES: "ethereum,arbitrum,base,solana,stellar",
  }));
  for (const id of ["ethereum", "arbitrum", "base", "solana", "stellar"] as const) {
    assert.equal(allCctp.find((route) => route.id === id)?.enabled, true, id);
  }
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "unknown" }), /unsupported_admitted_route/);
});
test("mainnet private send fails closed until escrow and privacy manifests are verified", () => {
  const config = loadConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example",
    RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32),
    PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    STARKNET_NETWORK: "mainnet",
    SOLANA_MAINNET_RPC_URL: "https://private-solana-rpc.example",
  });
  const routes = routesForConfig(config);
  assert.equal(routes.find((route) => route.id === "starknet-private")?.enabled, false);
  for (const id of ["starknet-public", "ethereum", "arbitrum", "base", "solana", "stellar"] as const) {
    assert.equal(routes.find((route) => route.id === id)?.enabled, false, id);
  }
});

test("mainnet verifiedEscrowPools exclude UNDEPLOYED and unapproved dens", () => {
  const config = loadConfig(mainnetEnv);
  const pools = verifiedEscrowPoolsForConfig(config);
  assert.equal(pools.length, 2);
  assert.deepEqual(pools.map((pool) => pool.denomination).sort(), ["100000", "1000000"]);
  for (const pool of pools) {
    assert.equal(pool.verification.status, "verified");
    assert.match(pool.address, /^0x[0-9a-f]+$/i);
    assert.match(pool.classHash, /^0x[0-9a-f]+$/i);
  }
  assert.equal(config.manifest.pools.filter((pool) => pool.address === "UNDEPLOYED").length, 3);
});

test("mainnet indexer watches only verified approved escrows and skips UNDEPLOYED", () => {
  const config = loadConfig(mainnetEnv);
  const addresses = [...indexedEscrowAddresses(config)].sort();
  const expected = verifiedEscrowPoolsForConfig(config)
    .map((pool) => `0x${BigInt(pool.address).toString(16)}`)
    .sort();
  assert.deepEqual(addresses, expected);
  assert.equal(addresses.length, 2);
  const start = indexedDeploymentStart(config);
  const verifiedBlocks = verifiedEscrowPoolsForConfig(config)
    .map((pool) => pool.deployedBlock)
    .filter((value): value is number => typeof value === "number");
  assert.equal(start, Math.min(...verifiedBlocks));
  assert.doesNotThrow(() => indexedEscrowAddresses(config));
});

test("indexer fails closed when no verified escrow pools remain", () => {
  const config = loadConfig(mainnetEnv);
  for (const pool of config.manifest.pools) {
    pool.verification.status = "skipped";
  }
  assert.throws(() => indexedEscrowAddresses(config), /indexer_verified_escrow_pools_empty/);
  assert.throws(() => indexedDeploymentStart(config), /indexer_deployment_block_missing/);
});

test("indexer ignores Mainnet directPrivacy even if present", () => {
  const config = loadConfig(mainnetEnv);
  config.manifest.directPrivacy = {
    status: "verified",
    escrow: {
      status: "verified",
      address: "0xdead",
      classHash: "0xbeef",
      deployedBlock: 1,
    },
  } as typeof config.manifest.directPrivacy;
  const addresses = indexedEscrowAddresses(config);
  assert.equal(addresses.has("0xdead"), false);
});

test("mainnet private send is admitted only as registered escrow-inbox delivery", () => {
  const config = loadConfig(mainnetEnv);
  config.manifest.verified = true;
  config.manifest.router.verification.status = "verified";
  config.manifest.router.address = "0x456";
  config.manifest.approvedCctpDenominations = ["1000000"];
  const pool = config.manifest.pools.find((candidate) => candidate.denomination === "1000000")!;
  pool.address = "0x789";
  pool.classHash = "0xabc";
  pool.verification.status = "verified";
  config.env.RUN_INDEXER = true;
  config.env.STARKNET_PRIVATE_ADMITTED = true;
  assert.equal(starknetEscrowInboxReady(config), false);
  config.starknetPrivateEvidenceVerified = true;
  assert.equal(starknetEscrowInboxReady(config), true);
  assert.equal(routesForConfig(config).find((route) => route.id === "starknet-private")?.enabled, true);
  assert.deepEqual(buildStarknetEscrowDepositPlan(config, {
    denomination: "1000000",
    claimHash: "0x111",
    publicRefundRecipient: "0x123",
    expiresAt: "2026-09-10T00:00:00.000Z",
  }), {
    kind: "starknet_public_deposit",
    usdc: config.manifest.usdc,
    escrowPool: "0x789",
    claimHash: "0x111",
    publicRefundRecipient: "0x123",
    expiresAt: 1788998400,
  });
  assert.doesNotThrow(() => assertStarknetPrivateEscrowIntent(config, {
    routeId: "starknet-private", mode: "private", deliveryKind: "registered", publicRefundRecipient: "0x123",
  }));
  assert.throws(() => assertStarknetPrivateEscrowIntent(config, {
    routeId: "starknet-private", mode: "standard", deliveryKind: "registered", publicRefundRecipient: "0x123",
  }), /direct_send_rejected/);
  assert.throws(() => assertStarknetPrivateEscrowIntent(config, {
    routeId: "starknet-private", mode: "private", deliveryKind: "pending", publicRefundRecipient: "0x123",
  }), /mainnet_registered_inbox_required/);
});

test("mainnet private admission fails closed without retained evidence", () => {
  assert.throws(
    () => loadConfig({ ...mainnetEnv, STARKNET_PRIVATE_ADMITTED: "true" }),
    /starknet_private_evidence_required/,
  );
});

test("mainnet force-admit skips evidence and allows public Solana RPC", () => {
  const config = loadConfig({
    ...mainnetEnv,
    MAINNET_FORCE_ADMIT: "true",
    STARKNET_PRIVATE_ADMITTED: "true",
    CCTP_ADMITTED_ROUTES: "base,solana",
    BASE_MAINNET_RPC_URL: "https://base-rpc.example",
    SOLANA_MAINNET_RPC_URL: "https://api.mainnet-beta.solana.com",
    RUN_INDEXER: "true",
  });
  assert.equal(config.forceAdmit, true);
  assert.equal(config.starknetPrivateEvidenceVerified, true);
  assert.equal(config.admittedCctpRoutes.has("base"), true);
  assert.equal(config.admittedCctpRoutes.has("solana"), true);
  config.manifest.verified = true;
  config.manifest.router.verification.status = "verified";
  config.manifest.router.address = "0x456";
  config.manifest.approvedCctpDenominations = ["1000000"];
  const pool = config.manifest.pools.find((candidate) => candidate.denomination === "1000000")!;
  pool.address = "0x789";
  pool.classHash = "0xabc";
  pool.verification.status = "verified";
  assert.equal(starknetEscrowInboxReady(config), true);
});
test("API rejects a network-mode header that does not match its manifest", () => {
  const config = { manifest: { chainId: "SN_SEPOLIA" } } as ReturnType<typeof loadConfig>;
  const testnetRequest = { headers: { "x-wotta-network": "testnet" } } as never;
  const mainnetRequest = { headers: { "x-wotta-network": "mainnet" } } as never;
  assert.equal(requestChainId(config, testnetRequest), "SN_SEPOLIA");
  assert.throws(() => requestChainId(config, mainnetRequest), /network_mode_mismatch/);
});
test("API errors preserve safe provider/database reasons without exposing hashes", () => {
  assert.equal(safeError({ message: "identity_already_linked" }), "identity_already_linked");
  assert.equal(safeError(new Error(`failed ${"a".repeat(64)}`)), "failed [REDACTED]");
});
test("configuration requires a valid pending-delivery private key", () => {
  const base = {
    SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "a".repeat(32),
    STARKNET_RPC_URL: "https://rpc.example", RESOLVER_SIGNING_KEY: "b".repeat(32),
    IDENTITY_LOOKUP_KEY: "c".repeat(32), PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
    SOLANA_MAINNET_RPC_URL: "https://private-solana-rpc.example",
  };
  const config = loadConfig(base);
  assert.equal(config.manifest.chainId, "SN_MAIN");
  assert.equal(config.manifestHash, config.manifest.manifestHash);
  assert.throws(() => loadConfig({ ...base, PENDING_DELIVERY_PRIVATE_KEY: "short" }), /PENDING_DELIVERY_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...base, STARKNET_NETWORK: "sepolia", DEPLOYMENT_MANIFEST_PATH: new URL("../../../deployments/mainnet.json", import.meta.url).pathname }), /network_manifest_mismatch/);
  assert.doesNotThrow(() => loadConfig({ ...base, CI: "true" }));
  // An inactive route must not prevent the isolated mainnet/private API from starting.
  assert.doesNotThrow(() => loadConfig({ ...base, SOLANA_MAINNET_RPC_URL: undefined }));
  assert.doesNotThrow(() => loadConfig({ ...base, SOLANA_MAINNET_RPC_URL: "" }));
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "solana", SOLANA_MAINNET_RPC_URL: undefined }), /solana_mainnet_rpc_required/);
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "solana", SOLANA_MAINNET_RPC_URL: "https://api.mainnet-beta.solana.com" }), /solana_mainnet_rpc_required/);
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "solana", SOLANA_MAINNET_RPC_URL: "https://api.devnet.solana.com" }), /solana_mainnet_rpc_required/);
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "base", BASE_MAINNET_RPC_URL: undefined }), /base_mainnet_rpc_required/);
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "ethereum" }), /unsupported_admitted_route/);
});
test("wallet challenges bind only an allowlisted dapp origin", () => {
  const config = { corsOrigins: ["http://localhost:3000", "https://app.wotta.example"] } as ReturnType<typeof loadConfig>;
  assert.equal(requireWalletOrigin(config, "http://localhost:3000"), "http://localhost:3000");
  assert.equal(requireWalletOrigin(config, "http://localhost:3000/"), "http://localhost:3000");
  assert.throws(() => requireWalletOrigin(config, "http://localhost:8787"), /origin_invalid/);
  assert.throws(() => requireWalletOrigin(config, undefined), /origin_invalid/);
});
test("wallet binding challenge stays within Ready's proven SNIP-12 type subset", () => {
  const typedData = walletBindingTypedData({
    profileId: "60e364f7-ca41-4598-b4c9-e835ea36f421",
    address: "0x123",
    origin: "http://localhost:3000",
    nonce: "0x456",
    issuedAt: new Date("2026-08-22T00:00:00.000Z"),
    expiresAt: new Date("2026-08-22T00:05:00.000Z"),
    chainId: "SN_SEPOLIA",
  });
  const message = typedData.message as Record<string, unknown>;
  assert.deepEqual(new Set(typedData.types.WottaWalletBinding!.map((field) => field.type)), new Set(["felt", "shortstring"]));
  assert.match(String(message.profile_hash), /^0x[0-9a-f]+$/);
  assert.match(String(message.origin_hash), /^0x[0-9a-f]+$/);
  assert.equal(message.address, "0x123");
});
test("wallet addresses normalize to canonical felt hex", () => {
  const padded = "0x0000000000000000000000000000000000000000000000000000000000000099";
  const short = "0x99";
  assert.equal(normalizeWalletAddress(padded), normalizeWalletAddress(short));
  assert.throws(() => normalizeWalletAddress("not-an-address"), /invalid_wallet_address/);
});

// --- Phase 1: route reason code assertions ---

const mainnetEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a".repeat(32),
  STARKNET_RPC_URL: "https://rpc.example",
  RESOLVER_SIGNING_KEY: "b".repeat(32),
  IDENTITY_LOOKUP_KEY: "c".repeat(32),
  PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  STARKNET_NETWORK: "mainnet",
  SOLANA_MAINNET_RPC_URL: "https://private-solana-rpc.example",
} as const;

const testnetEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "a".repeat(32),
  STARKNET_RPC_URL: "https://rpc.example",
  RESOLVER_SIGNING_KEY: "b".repeat(32),
  IDENTITY_LOOKUP_KEY: "c".repeat(32),
  PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url"),
  STARKNET_NETWORK: "sepolia",
} as const;

test("mainnet: ethereum, arbitrum, stellar always return coming_soon", () => {
  const routes = routesForConfig(loadConfig(mainnetEnv));
  for (const id of ["ethereum", "arbitrum", "stellar"] as const) {
    const route = routes.find((r) => r.id === id);
    assert.equal(route?.enabled, false, `${id} should be disabled`);
    assert.equal(route?.reason, "coming_soon", `${id} should have coming_soon reason`);
  }
});

test("mainnet: base and solana return awaiting_route_evidence after deployment but before admission", () => {
  const routes = routesForConfig(loadConfig(mainnetEnv));
  // Contracts are verified, but neither route has retained live evidence or admission.
  for (const id of ["base", "solana"] as const) {
    const route = routes.find((r) => r.id === id);
    assert.equal(route?.enabled, false, `${id} should be disabled`);
    assert.equal(route?.reason, "awaiting_route_evidence", `${id} should have awaiting_route_evidence`);
  }
});

test("testnet: base and solana never return coming_soon (that reason is mainnet-only)", () => {
  const routes = routesForConfig(loadConfig(testnetEnv));
  for (const id of ["ethereum", "arbitrum", "base", "solana", "stellar"] as const) {
    const route = routes.find((r) => r.id === id);
    assert.notEqual(route?.reason, "coming_soon", `${id} must not return coming_soon on testnet`);
  }
});

// --- Phase 2: assertMainnetWorkerReadiness precondition tests ---

const WORKER_CONFIG_SENTINEL = Symbol("not-set");
type MaybeUnset<T> = T | typeof WORKER_CONFIG_SENTINEL;

/** Build a minimal Config-shaped object for assertMainnetWorkerReadiness tests. */
function makeWorkerConfig(overrides: {
  chainId?: string;
  manifestVerified?: boolean;
  routerVerified?: boolean;
  poolsVerified?: boolean;
  admittedRoutes?: string[];
  relayerAddress?: MaybeUnset<string>;
  relayerKey?: MaybeUnset<string>;
  fallbackRpc?: MaybeUnset<string>;
  runtimeVerified?: boolean;
  workerPair?: boolean;
  deployerAddress?: string;
}) {
  const relayerAddress = overrides.relayerAddress === WORKER_CONFIG_SENTINEL
    ? undefined
    : (overrides.relayerAddress ?? "0x1234");
  const relayerKey = overrides.relayerKey === WORKER_CONFIG_SENTINEL
    ? undefined
    : (overrides.relayerKey ?? "0xabcd");
  const fallbackRpc = overrides.fallbackRpc === WORKER_CONFIG_SENTINEL
    ? undefined
    : (overrides.fallbackRpc ?? "https://fallback.example");
  return {
    manifest: {
      chainId: overrides.chainId ?? "SN_MAIN",
      verified: overrides.manifestVerified ?? true,
      approvedCctpDenominations: ["1000000"],
      deployer: { address: overrides.deployerAddress ?? "0x9999" },
      router: {
        verification: { status: (overrides.routerVerified ?? true) ? "verified" : "pending" },
      },
      pools: [
        { denomination: "1000000", verification: { status: (overrides.poolsVerified ?? true) ? "verified" : "pending" } },
      ],
    },
    admittedCctpRoutes: new Set(overrides.admittedRoutes ?? ["base"]),
    runtimeVerifiedCctpRoutes: new Set(overrides.runtimeVerified === false ? [] : (overrides.admittedRoutes ?? ["base"])),
    env: {
      RUN_INDEXER: overrides.workerPair ?? true,
      RUN_RELAYER: overrides.workerPair ?? true,
      STARKNET_PRIVATE_ADMITTED: false,
      STARKNET_RPC_URL: "https://primary.example",
      STARKNET_RELAYER_ADDRESS: relayerAddress,
      STARKNET_RELAYER_PRIVATE_KEY: relayerKey,
      STARKNET_RELAYER_KEY_OR_KEYSTORE: undefined,
      STARKNET_DEPLOYER_ADDRESS: undefined,
      STARKNET_DEPLOYER_PRIVATE_KEY: undefined,
      STARKNET_FALLBACK_RPC_URL: fallbackRpc,
    },
  // biome-ignore lint: cast to Config for test purposes
  } as unknown as ReturnType<typeof loadConfig>;
}

test("assertMainnetWorkerReadiness: testnet is a no-op", () => {
  const config = makeWorkerConfig({ chainId: "SN_SEPOLIA", manifestVerified: false, routerVerified: false, poolsVerified: false, admittedRoutes: [], relayerAddress: WORKER_CONFIG_SENTINEL, relayerKey: WORKER_CONFIG_SENTINEL, fallbackRpc: WORKER_CONFIG_SENTINEL });
  // Must not throw
  assert.doesNotThrow(() => assertMainnetWorkerReadiness(config));
});

test("assertMainnetWorkerReadiness: rejects when manifest not verified", () => {
  const config = makeWorkerConfig({ manifestVerified: false });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_manifest_not_verified/);
});

test("assertMainnetWorkerReadiness: rejects when router not verified", () => {
  const config = makeWorkerConfig({ routerVerified: false });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_router_not_verified/);
});

test("assertMainnetWorkerReadiness: rejects when a pool is not verified", () => {
  const config = makeWorkerConfig({ poolsVerified: false });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_pool_not_verified/);
});

test("assertMainnetWorkerReadiness: rejects when no admitted CCTP routes", () => {
  const config = makeWorkerConfig({ admittedRoutes: [] });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_no_admitted_routes/);
});

test("assertMainnetWorkerReadiness: rejects when relayer credentials missing", () => {
  const config = makeWorkerConfig({ relayerAddress: WORKER_CONFIG_SENTINEL, relayerKey: WORKER_CONFIG_SENTINEL });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_relayer_credentials_missing/);
});

test("assertMainnetWorkerReadiness: rejects when fallback RPC absent", () => {
  const config = makeWorkerConfig({ fallbackRpc: WORKER_CONFIG_SENTINEL });
  assert.throws(() => assertMainnetWorkerReadiness(config), /mainnet_worker_fallback_rpc_required/);
});

test("assertMainnetWorkerReadiness: requires distinct mainnet relayer and RPC operators", () => {
  assert.throws(
    () => assertMainnetWorkerReadiness(makeWorkerConfig({ deployerAddress: "0x1234" })),
    /relayer_must_be_separate/,
  );
  const config = makeWorkerConfig({});
  config.env.STARKNET_FALLBACK_RPC_URL = "https://primary.example/fallback";
  assert.throws(() => assertMainnetWorkerReadiness(config), /fallback_operator_required/);
});

test("assertMainnetWorkerReadiness: requires both workers and verified source RPCs", () => {
  assert.throws(() => assertMainnetWorkerReadiness(makeWorkerConfig({ workerPair: false })), /worker_pair_required/);
  assert.throws(() => assertMainnetWorkerReadiness(makeWorkerConfig({ runtimeVerified: false })), /source_rpc_unverified/);
});

test("assertMainnetWorkerReadiness: private escrow requires an indexer and independent fallback RPC", () => {
  const noIndexer = makeWorkerConfig({ admittedRoutes: [], workerPair: false });
  noIndexer.env.STARKNET_PRIVATE_ADMITTED = true;
  assert.throws(() => assertMainnetWorkerReadiness(noIndexer), /mainnet_private_indexer_required/);

  const noFallback = makeWorkerConfig({ admittedRoutes: [], workerPair: false, fallbackRpc: WORKER_CONFIG_SENTINEL });
  noFallback.env.STARKNET_PRIVATE_ADMITTED = true;
  noFallback.env.RUN_INDEXER = true;
  assert.throws(() => assertMainnetWorkerReadiness(noFallback), /mainnet_worker_fallback_rpc_required/);
});

test("mainnet fallback RPC must be live and bound to SN_MAIN before workers start", async () => {
  const config = makeWorkerConfig({});
  await assert.doesNotReject(() => assertMainnetFallbackRpcNetwork(config, async () => "0x534e5f4d41494e"));
  await assert.rejects(
    () => assertMainnetFallbackRpcNetwork(config, async () => { throw new Error("retired provider"); }),
    /starknet_fallback_rpc_unavailable/,
  );
  await assert.rejects(
    () => assertMainnetFallbackRpcNetwork(config, async () => "0x534e5f5345504f4c4941"),
    /starknet_fallback_rpc_network_mismatch/,
  );
});

test("mainnet source RPC probes bind Base and Solana to their real networks", async () => {
  const config = loadConfig({
    ...mainnetEnv,
    CCTP_ADMITTED_ROUTES: "base,solana",
    BASE_MAINNET_RPC_URL: "https://base-rpc.example",
  });
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const method = JSON.parse(String(init?.body)).method;
    const result = method === "eth_chainId"
      ? "0x2105"
      : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  await assertMainnetSourceRpcNetworks(config, fetchImpl);
  assert.deepEqual([...config.runtimeVerifiedCctpRoutes].sort(), ["base", "solana"]);

  const wrongBase = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x14a34" }), { status: 200 })) as typeof fetch;
  await assert.rejects(() => assertMainnetSourceRpcNetworks(config, wrongBase), /base_rpc_network_mismatch/);
  assert.equal(config.runtimeVerifiedCctpRoutes.size, 0);
});

test("pilot config parses per-tx cap and paused routes", () => {
  assert.throws(() => loadConfig({ ...mainnetEnv, PILOT_MAX_USDC_PER_TX: "abc" }), /PILOT_MAX_USDC_PER_TX/);
  const config = loadConfig({
    ...mainnetEnv,
    PILOT_MAX_USDC_PER_TX: "100000000",
    PILOT_PAUSED_ROUTES: "base, solana",
  });
  assert.equal(config.pilotMaxUsdcPerTx, 100_000_000);
  assert.deepEqual([...config.pilotPausedRoutes].sort(), ["base", "solana"]);
});

test("CCTP quote path enforces transfer cap and per-route pause", () => {
  const config = loadConfig({
    ...mainnetEnv,
    PILOT_MAX_USDC_PER_TX: "1000000",
    PILOT_PAUSED_ROUTES: "base",
  });
  assert.throws(() => assertCctpPilotControls(config, { routeId: "solana", denomination: "10000000" }), /transfer_cap_exceeded/);
  assert.throws(() => assertCctpPilotControls(config, { routeId: "base", denomination: "1000000" }), /route_paused/);
  assert.doesNotThrow(() => assertCctpPilotControls(config, { routeId: "solana", denomination: "1000000" }));
  assert.doesNotThrow(() => assertCctpPilotControls(config, { routeId: "starknet-public", denomination: "10000000" }));
});

function liveMainnetCctpConfig(pausedRoutes = "") {
  const config = loadConfig({
    ...mainnetEnv,
    CCTP_ADMITTED_ROUTES: "base,solana",
    BASE_MAINNET_RPC_URL: "https://base-rpc.example",
    RUN_INDEXER: "true",
    RUN_RELAYER: "true",
    PILOT_PAUSED_ROUTES: pausedRoutes,
  });
  config.runtimeVerifiedCctpRoutes.add("base");
  config.runtimeVerifiedCctpRoutes.add("solana");
  config.manifest.verified = true;
  config.manifest.approvedCctpDenominations = ["1000000"];
  config.manifest.router.address = "0x1234";
  config.manifest.router.verification.status = "verified";
  for (const pool of config.manifest.pools) {
    if (pool.denomination === "1000000") pool.verification.status = "verified";
  }
  return config;
}

test("Base and Solana use Fast finality while other rails remain Standard/Finalized", () => {
  assert.equal(cctpFinalityThreshold("base"), 1000);
  assert.equal(cctpFinalityThreshold("solana"), 1000);
  assert.equal(cctpFinalityThreshold("stellar"), 2000);
});

test("admitting Base independently does not enable Solana", () => {
  const config = liveMainnetCctpConfig();
  config.admittedCctpRoutes = new Set(["base"]);
  config.runtimeVerifiedCctpRoutes.delete("solana");
  const routes = routesForConfig(config);
  assert.equal(routes.find((route) => route.id === "base")?.enabled, true);
  assert.equal(routes.find((route) => route.id === "solana")?.enabled, false);
  assert.equal(routes.find((route) => route.id === "solana")?.reason, "awaiting_route_evidence");
});

test("pausing Base does not change Solana capability", () => {
  const routes = routesForConfig(liveMainnetCctpConfig("base"));
  assert.equal(routes.find((route) => route.id === "base")?.enabled, false);
  assert.equal(routes.find((route) => route.id === "base")?.reason, "route_paused");
  assert.equal(routes.find((route) => route.id === "solana")?.enabled, true);
  assert.equal(routes.find((route) => route.id === "solana")?.reason, undefined);
});
