import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIdentifier } from "../src/auth/normalize.ts";
import { quoteMatchesStoredIntent, sameFelt, sameInstant, transitionAllowed } from "../src/intents/service.ts";
import { ROUTES, routesForConfig } from "../src/routes.ts";
import { loadConfig } from "../src/config.ts";
import { collectVerifiedIdentities } from "../src/auth/sync.ts";
import { decodeEscrowProjection } from "../src/indexer/run.ts";
import { hash } from "starknet";
import { safeError } from "../src/logger.ts";
import { requireWalletOrigin, walletBindingTypedData } from "../src/auth/challenge.ts";

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
  const baseOnly = routesForConfig(loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "base" }));
  assert.equal(baseOnly.find((route) => route.id === "base")?.enabled, true);
  assert.equal(baseOnly.find((route) => route.id === "ethereum")?.enabled, false);
  assert.throws(() => loadConfig({ ...base, CCTP_ADMITTED_ROUTES: "unknown" }), /unsupported_admitted_route/);
});
test("API errors preserve safe provider/database reasons without exposing hashes", () => {
  assert.equal(safeError({ message: "identity_already_linked" }), "identity_already_linked");
  assert.equal(safeError(new Error(`failed ${"a".repeat(64)}`)), "failed [REDACTED]");
});
test("configuration requires a valid pending-delivery private key", () => {
  const base = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "a".repeat(32), STARKNET_RPC_URL: "https://rpc.example", RESOLVER_SIGNING_KEY: "b".repeat(32), IDENTITY_LOOKUP_KEY: "c".repeat(32), PENDING_DELIVERY_PRIVATE_KEY: Buffer.alloc(32, 1).toString("base64url") };
  const config = loadConfig(base);
  assert.equal(config.manifest.chainId, "SN_MAIN");
  assert.equal(config.manifestHash, config.manifest.manifestHash);
  assert.throws(() => loadConfig({ ...base, PENDING_DELIVERY_PRIVATE_KEY: "short" }), /PENDING_DELIVERY_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...base, STARKNET_NETWORK: "sepolia", DEPLOYMENT_MANIFEST_PATH: new URL("../../../deployments/mainnet.json", import.meta.url).pathname }), /network_manifest_mismatch/);
  assert.doesNotThrow(() => loadConfig({ ...base, CI: "true" }));
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
