import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import type { IntentState } from "@wotta/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { cctpPoolsForConfig, routeById } from "../routes.ts";
import { buildEvmCctpBurnCalls, buildNonEvmCctpBurnPlan, type CircleEnvironment } from "@wotta/adapters";
import { DENOMINATION_CODES } from "@wotta/shared";
import { quoteCircleExactNet } from "../quotes/circle.ts";
import { assertRelayerReadyForBurn } from "../relayer/readiness.ts";

const allowed: Record<IntentState, readonly IntentState[]> = {
  draft: ["quoted", "failed_terminal"], quoted: ["source_submitted", "failed_recoverable", "failed_terminal"], source_submitted: ["source_confirmed", "failed_recoverable", "failed_terminal"], source_confirmed: ["attestation_ready", "funded", "delivered", "completed", "failed_recoverable"], attestation_ready: ["destination_submitted", "failed_recoverable"], destination_submitted: ["funded", "failed_recoverable"], funded: ["delivered", "claimable", "expired", "failed_recoverable"], delivered: ["claimable", "completed", "expired", "failed_recoverable"], claimable: ["claimed", "expired", "failed_recoverable"], claimed: [], expired: ["refundable", "failed_recoverable"], refundable: ["refunded", "failed_recoverable"], refunded: [], completed: [], failed_recoverable: ["source_submitted", "source_confirmed", "attestation_ready", "destination_submitted", "funded", "delivered", "claimable", "expired", "refundable", "failed_terminal"], failed_terminal: [],
};
export function transitionAllowed(from: IntentState, to: IntentState) { return allowed[from].includes(to); }
export async function createIntent(db: Db, config: Config, ownerId: string, input: Record<string, unknown>) {
  assertCctpRoutePaused(config, String(input.routeId));
  const route = routeById(String(input.routeId), config);
  if (!route?.enabled) throw new Error(`route_disabled:${route?.reason ?? "unknown_route"}`);
  assertStarknetPrivateEscrowIntent(config, input);
  const chainId = config.manifest.chainId;
  const { error } = await db.from("intents").insert({ id: input.id, owner_id: ownerId, chain_id: chainId, mode: input.mode, delivery_kind: input.deliveryKind, denomination: input.denomination, route_id: input.routeId, claim_hash: input.claimHash, refund_hash: input.refundHash ?? null, public_refund_recipient: input.publicRefundRecipient ?? null, expires_at: input.expiresAt }); if (error) throw error;
  await appendEvent(db, String(input.id), "draft", "draft", 0, {}, { created: true }); return getIntent(db, ownerId, String(input.id), chainId);
}
/** Optional chain scope prevents one shared Supabase project from crossing environments. */
export async function getIntent(db: Db, ownerId: string, intentId: string, chainId?: string) {
  let query = db.from("intents").select("*").eq("id", intentId).eq("owner_id", ownerId);
  if (chainId) query = query.eq("chain_id", chainId);
  const { data, error } = await query.maybeSingle(); if (error) throw error; if (!data) throw new Error("not_found"); return data;
}
export async function transition(db: Db, ownerId: string, intentId: string, expectedVersion: number, to: IntentState, evidence: Record<string, unknown> = {}) {
  const current = await getIntent(db, ownerId, intentId); const from = current.state as IntentState;
  if (!transitionAllowed(from, to)) throw new Error("invalid_transition"); if (current.version !== expectedVersion) throw new Error("version_conflict");
  const { data, error } = await db.from("intents").update({ state: to, version: expectedVersion + 1, updated_at: new Date().toISOString() }).eq("id", intentId).eq("owner_id", ownerId).eq("version", expectedVersion).select("*").maybeSingle();
  if (error) throw error; if (!data) throw new Error("version_conflict"); await appendEvent(db, intentId, from, to, expectedVersion + 1, evidence, {}); return data;
}
export async function markSourceSubmitted(db: Db, ownerId: string, intentId: string, expectedVersion: number, txHash: string, chainId?: string) {
  const current = await getIntent(db, ownerId, intentId, chainId);
  if (current.state !== "quoted" || current.version !== expectedVersion) throw new Error("version_conflict");
  const { data, error } = await db.from("intents").update({ source_tx_hash: txHash, state: "source_submitted", version: expectedVersion + 1, updated_at: new Date().toISOString() }).eq("id", intentId).eq("owner_id", ownerId).eq("state", "quoted").eq("version", expectedVersion).select("*").maybeSingle();
  if (error) throw error; if (!data) throw new Error("version_conflict");
  if (current.route_id !== "starknet-public" && current.route_id !== "starknet-private") {
    const { data: existingJob, error: existingError } = await db.from("relayer_jobs").select("attempts").eq("intent_id", intentId).maybeSingle();
    if (existingError) throw existingError;
    if (existingJob) {
      const { error: jobError } = await db.from("relayer_jobs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("intent_id", intentId);
      if (jobError) throw jobError;
    } else {
      const { error: jobError } = await db.from("relayer_jobs").insert({ intent_id: intentId, status: "queued", attempts: 0 });
      if (jobError) throw jobError;
    }
  }
  await appendEvent(db, intentId, "quoted", "source_submitted", expectedVersion + 1, { txHash }, {});
  return data;
}
export async function appendEvent(db: Db, intentId: string, from: string | null, to: string, version: number, evidence: Record<string, unknown>, payload: Record<string, unknown>) { const { error } = await db.from("intent_events").insert({ intent_id: intentId, from_state: from, to_state: to, version, evidence, payload }); if (error) throw error; }
/** Postgres timestamptz often returns +00:00 while clients send Z; compare instants. */
export function sameInstant(left: unknown, right: unknown): boolean {
  const a = Date.parse(String(left ?? ""));
  const b = Date.parse(String(right ?? ""));
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** Starknet felts may differ only by zero-padding or hex case. */
export function sameFelt(left: unknown, right: unknown): boolean {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a && !b) return true;
  if (!a || !b) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

export function quoteMatchesStoredIntent(
  intent: {
    route_id: string;
    denomination: unknown;
    claim_hash: string;
    public_refund_recipient: string | null;
    expires_at: string;
  },
  input: Record<string, unknown>,
): boolean {
  return intent.route_id === input.routeId
    && String(intent.denomination) === String(input.denomination)
    && sameFelt(intent.claim_hash, input.claimHash)
    && sameFelt(intent.public_refund_recipient ?? "", input.publicRefundRecipient ?? "")
    && sameInstant(intent.expires_at, input.expiresAt);
}

export async function signQuote(db: Db, config: Config, ownerId: string, input: Record<string, unknown>) {
  assertCctpRoutePaused(config, String(input.routeId));
  const route = routeById(String(input.routeId), config); if (!route?.enabled) throw new Error(`route_disabled:${route?.reason ?? "unknown_route"}`);
  const intent = await getIntent(db, ownerId, String(input.id), config.manifest.chainId);
  if (intent.state !== "draft") throw new Error("invalid_transition");
  if (!quoteMatchesStoredIntent(intent, input)) throw new Error("quote_intent_mismatch");
  const expiresAt = Math.floor(Date.now() / 1000) + 120, quoteId = crypto.randomUUID();

  assertStarknetPrivateEscrowIntent(config, input);
  if (String(input.routeId) === "starknet-public" || String(input.routeId) === "starknet-private") {
    const sourcePlan = buildStarknetEscrowDepositPlan(config, input);
    const quote = { version: 1, quoteId, intentId: input.id, routeId: input.routeId, sourceAccount: input.sourceAccount, denomination: input.denomination, requestedReceive: input.denomination, grossDebit: input.denomination, maxFee: "0", minFinalityThreshold: 0, claimHash: input.claimHash, refundRecipient: input.publicRefundRecipient, manifestHash: config.manifestHash, sourcePlan, issuedAt: Math.floor(Date.now() / 1000), expiresAt };
    const signature = await new SignJWT(quote).setProtectedHeader({ alg: "HS256", typ: "wotta+quote" }).setIssuedAt().setExpirationTime(expiresAt).sign(new TextEncoder().encode(config.env.RESOLVER_SIGNING_KEY));
    const { data: updated, error } = await db.from("intents").update({ quote: { quote, signature }, state: "quoted", version: 1, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("owner_id", ownerId).eq("state", "draft").eq("version", 0).select("id").maybeSingle(); if (error) throw error; if (!updated) throw new Error("version_conflict");
    await appendEvent(db, intent.id, "draft", "quoted", 1, {}, { quoteId }); return { quote, signature };
  }

  if (route.domain === null) throw new Error("route_disabled:not_cctp");
  assertCctpTransferCap(config, input);
  const routeId = String(input.routeId);
  const minFinalityThreshold = cctpFinalityThreshold(routeId);
  await assertRelayerReadyForBurn(config);
  const exactNet = await quoteCircleExactNet({ irisBaseUrl: config.env.CIRCLE_IRIS_BASE_URL, sourceDomain: route.domain, destinationDomain: 25, requestedReceive: BigInt(String(input.denomination)), minFinalityThreshold });
  const sourcePlan = buildSourcePlan(config, input, exactNet.grossDebit, exactNet.maxFee, minFinalityThreshold);
  const quote = { version: 1, quoteId, intentId: input.id, routeId: input.routeId, sourceAccount: input.sourceAccount, denomination: input.denomination, requestedReceive: input.denomination, grossDebit: exactNet.grossDebit.toString(), maxFee: exactNet.maxFee.toString(), minFinalityThreshold, claimHash: input.claimHash, refundRecipient: input.publicRefundRecipient, manifestHash: config.manifestHash, sourcePlan, issuedAt: Math.floor(Date.now() / 1000), expiresAt };
  const signature = await new SignJWT(quote).setProtectedHeader({ alg: "HS256", typ: "wotta+quote" }).setIssuedAt().setExpirationTime(expiresAt).sign(new TextEncoder().encode(config.env.RESOLVER_SIGNING_KEY));
  const { data: updated, error } = await db.from("intents").update({ quote: { quote, signature }, state: "quoted", version: 1, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("owner_id", ownerId).eq("state", "draft").eq("version", 0).select("id").maybeSingle(); if (error) throw error; if (!updated) throw new Error("version_conflict");
  await appendEvent(db, intent.id, "draft", "quoted", 1, {}, { quoteId }); return { quote, signature };
}

export function buildStarknetEscrowDepositPlan(config: Config, input: Record<string, unknown>) {
  const denomination = String(input.denomination) as keyof typeof DENOMINATION_CODES;
  const escrow = cctpPoolsForConfig(config).find((pool) => pool.denomination === denomination && pool.verification.status === "verified");
  if (!escrow || !/^0x[0-9a-f]+$/i.test(config.manifest.usdc)) throw new Error("route_disabled:missing_router_or_pool");
  if (!input.publicRefundRecipient) throw new Error("invalid_public_refund_recipient");
  return {
    kind: "starknet_public_deposit" as const,
    usdc: config.manifest.usdc,
    escrowPool: escrow.address,
    claimHash: String(input.claimHash),
    publicRefundRecipient: String(input.publicRefundRecipient),
    expiresAt: Math.floor(Date.parse(String(input.expiresAt)) / 1000),
  };
}

export function assertStarknetPrivateEscrowIntent(_config: Config, input: Record<string, unknown>): void {
  if (input.routeId !== "starknet-private") return;
  if (input.mode !== "private") throw new Error("direct_send_rejected:escrow_inbox_required");
  if (input.deliveryKind !== "registered") throw new Error("invalid_delivery_kind:mainnet_registered_inbox_required");
  if (!input.publicRefundRecipient) throw new Error("invalid_public_refund_recipient");
}

/** Base and Solana are fast pilot rails; other sources retain Standard finality. */
export function cctpFinalityThreshold(routeId: string): 1000 | 2000 {
  return routeId === "base" || routeId === "solana" ? 1000 : 2000;
}

const CCTP_SOURCE_IDS = new Set(["ethereum", "arbitrum", "base", "solana", "stellar"]);

/** Pause applies only to CCTP sources, not Starknet-native deposits. */
export function assertCctpRoutePaused(config: Config, routeId: string): void {
  if (!CCTP_SOURCE_IDS.has(routeId)) return;
  if (config.pilotPausedRoutes.has(routeId)) throw new Error("route_paused");
}

/** Cap applies only to CCTP quote signing, not Starknet-native deposits. */
export function assertCctpPilotControls(config: Config, input: Record<string, unknown>): void {
  assertCctpRoutePaused(config, String(input.routeId));
  assertCctpTransferCap(config, input);
}

function assertCctpTransferCap(config: Config, input: Record<string, unknown>): void {
  if (!CCTP_SOURCE_IDS.has(String(input.routeId))) return;
  if (config.pilotMaxUsdcPerTx !== undefined && Number(input.denomination) > config.pilotMaxUsdcPerTx) {
    throw new Error("transfer_cap_exceeded");
  }
}

function buildSourcePlan(config: Config, input: Record<string, unknown>, grossDebit: bigint, maxFee: bigint, minFinalityThreshold: 1000 | 2000) {
  const routeId = String(input.routeId) as "ethereum" | "arbitrum" | "base" | "solana" | "stellar";
  const denomination = String(input.denomination) as keyof typeof DENOMINATION_CODES;
  const escrow = cctpPoolsForConfig(config).find((pool) => pool.denomination === denomination && pool.verification.status === "verified");
  if (!escrow || !/^0x[0-9a-f]+$/i.test(config.manifest.router.address)) throw new Error("route_disabled:missing_router_or_pool");
  if (!input.publicRefundRecipient) throw new Error("invalid_public_refund_recipient");
  const hook = {
    intentId: String(input.id), denominationCode: DENOMINATION_CODES[denomination], escrowPool: escrow.address,
    claimHash: String(input.claimHash), publicRefundRecipient: String(input.publicRefundRecipient),
    expiresAt: BigInt(Math.floor(Date.parse(String(input.expiresAt)) / 1000)), manifestVersion: 1,
  };
  const env: CircleEnvironment = config.manifest.chainId === "SN_MAIN" ? "mainnet" : "testnet";
  const common = { env, router: config.manifest.router.address as `0x${string}`, amount: grossDebit, hook, maxFee, minFinalityThreshold };
  return routeId === "solana" || routeId === "stellar"
    ? buildNonEvmCctpBurnPlan({ ...common, route: routeId })
    : buildEvmCctpBurnCalls({ ...common, route: routeId });
}
export function requestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
