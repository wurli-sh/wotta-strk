import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import type { IntentState } from "@wotta/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { routeById } from "../routes.ts";
import { buildEvmCctpBurnCalls, buildNonEvmCctpBurnPlan } from "@wotta/adapters";
import { DENOMINATION_CODES } from "@wotta/shared";
import { quoteCircleExactNet } from "../quotes/circle.ts";

const allowed: Record<IntentState, readonly IntentState[]> = {
  draft: ["quoted", "failed_terminal"], quoted: ["source_submitted", "failed_recoverable", "failed_terminal"], source_submitted: ["source_confirmed", "failed_recoverable", "failed_terminal"], source_confirmed: ["attestation_ready", "funded", "delivered", "completed", "failed_recoverable"], attestation_ready: ["destination_submitted", "failed_recoverable"], destination_submitted: ["funded", "failed_recoverable"], funded: ["delivered", "claimable", "expired", "failed_recoverable"], delivered: ["claimable", "completed", "expired", "failed_recoverable"], claimable: ["claimed", "expired", "failed_recoverable"], claimed: [], expired: ["refundable", "failed_recoverable"], refundable: ["refunded", "failed_recoverable"], refunded: [], completed: [], failed_recoverable: ["source_submitted", "source_confirmed", "attestation_ready", "destination_submitted", "funded", "delivered", "claimable", "expired", "refundable", "failed_terminal"], failed_terminal: [],
};
export function transitionAllowed(from: IntentState, to: IntentState) { return allowed[from].includes(to); }
export async function createIntent(db: Db, ownerId: string, input: Record<string, unknown>) {
  const { error } = await db.from("intents").insert({ id: input.id, owner_id: ownerId, mode: input.mode, delivery_kind: input.deliveryKind, denomination: input.denomination, route_id: input.routeId, claim_hash: input.claimHash, refund_hash: input.refundHash ?? null, public_refund_recipient: input.publicRefundRecipient ?? null, expires_at: input.expiresAt }); if (error) throw error;
  await appendEvent(db, String(input.id), "draft", "draft", 0, {}, { created: true }); return getIntent(db, ownerId, String(input.id));
}
export async function getIntent(db: Db, ownerId: string, intentId: string) { const { data, error } = await db.from("intents").select("*").eq("id", intentId).eq("owner_id", ownerId).maybeSingle(); if (error) throw error; if (!data) throw new Error("not_found"); return data; }
export async function transition(db: Db, ownerId: string, intentId: string, expectedVersion: number, to: IntentState, evidence: Record<string, unknown> = {}) {
  const current = await getIntent(db, ownerId, intentId); const from = current.state as IntentState;
  if (!transitionAllowed(from, to)) throw new Error("invalid_transition"); if (current.version !== expectedVersion) throw new Error("version_conflict");
  const { data, error } = await db.from("intents").update({ state: to, version: expectedVersion + 1, updated_at: new Date().toISOString() }).eq("id", intentId).eq("owner_id", ownerId).eq("version", expectedVersion).select("*").maybeSingle();
  if (error) throw error; if (!data) throw new Error("version_conflict"); await appendEvent(db, intentId, from, to, expectedVersion + 1, evidence, {}); return data;
}
export async function markSourceSubmitted(db: Db, ownerId: string, intentId: string, expectedVersion: number, txHash: string) {
  const current = await getIntent(db, ownerId, intentId);
  if (current.state !== "quoted" || current.version !== expectedVersion) throw new Error("version_conflict");
  const { data, error } = await db.from("intents").update({ source_tx_hash: txHash, state: "source_submitted", version: expectedVersion + 1, updated_at: new Date().toISOString() }).eq("id", intentId).eq("owner_id", ownerId).eq("state", "quoted").eq("version", expectedVersion).select("*").maybeSingle();
  if (error) throw error; if (!data) throw new Error("version_conflict");
  if (current.route_id !== "starknet-public") {
    const { error: jobError } = await db.from("relayer_jobs").upsert({ intent_id: intentId, status: "queued", attempts: 0 }, { onConflict: "intent_id" });
    if (jobError) throw jobError;
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
  const route = routeById(String(input.routeId), config); if (!route?.enabled) throw new Error(`route_disabled:${route?.reason ?? "unknown_route"}`);
  const intent = await getIntent(db, ownerId, String(input.id));
  if (intent.state !== "draft") throw new Error("invalid_transition");
  if (!quoteMatchesStoredIntent(intent, input)) throw new Error("quote_intent_mismatch");
  const expiresAt = Math.floor(Date.now() / 1000) + 120, quoteId = crypto.randomUUID();

  if (String(input.routeId) === "starknet-public") {
    const denomination = String(input.denomination) as keyof typeof DENOMINATION_CODES;
    const escrow = config.manifest.pools.find((pool) => pool.denomination === denomination);
    if (!escrow || !/^0x[0-9a-f]+$/i.test(config.manifest.usdc)) throw new Error("route_disabled:missing_router_or_pool");
    if (!input.publicRefundRecipient) throw new Error("invalid_public_refund_recipient");
    const sourcePlan = {
      kind: "starknet_public_deposit" as const,
      usdc: config.manifest.usdc,
      escrowPool: escrow.address,
      claimHash: String(input.claimHash),
      publicRefundRecipient: String(input.publicRefundRecipient),
      expiresAt: Math.floor(Date.parse(String(input.expiresAt)) / 1000),
    };
    const quote = { version: 1, quoteId, intentId: input.id, routeId: input.routeId, sourceAccount: input.sourceAccount, denomination: input.denomination, requestedReceive: input.denomination, grossDebit: input.denomination, maxFee: "0", minFinalityThreshold: 0, claimHash: input.claimHash, refundRecipient: input.publicRefundRecipient, manifestHash: config.manifestHash, sourcePlan, issuedAt: Math.floor(Date.now() / 1000), expiresAt };
    const signature = await new SignJWT(quote).setProtectedHeader({ alg: "HS256", typ: "wotta+quote" }).setIssuedAt().setExpirationTime(expiresAt).sign(new TextEncoder().encode(config.env.RESOLVER_SIGNING_KEY));
    const { data: updated, error } = await db.from("intents").update({ quote: { quote, signature }, state: "quoted", version: 1, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("owner_id", ownerId).eq("state", "draft").eq("version", 0).select("id").maybeSingle(); if (error) throw error; if (!updated) throw new Error("version_conflict");
    await appendEvent(db, intent.id, "draft", "quoted", 1, {}, { quoteId }); return { quote, signature };
  }

  if (route.domain === null) throw new Error("route_disabled:not_cctp");
  const routeId = String(input.routeId);
  const minFinalityThreshold = cctpFinalityThreshold(routeId);
  const exactNet = await quoteCircleExactNet({ irisBaseUrl: config.env.CIRCLE_IRIS_BASE_URL, sourceDomain: route.domain, destinationDomain: 25, requestedReceive: BigInt(String(input.denomination)), minFinalityThreshold });
  const sourcePlan = buildSourcePlan(config, input, exactNet.grossDebit, exactNet.maxFee, minFinalityThreshold);
  const quote = { version: 1, quoteId, intentId: input.id, routeId: input.routeId, sourceAccount: input.sourceAccount, denomination: input.denomination, requestedReceive: input.denomination, grossDebit: exactNet.grossDebit.toString(), maxFee: exactNet.maxFee.toString(), minFinalityThreshold, claimHash: input.claimHash, refundRecipient: input.publicRefundRecipient, manifestHash: config.manifestHash, sourcePlan, issuedAt: Math.floor(Date.now() / 1000), expiresAt };
  const signature = await new SignJWT(quote).setProtectedHeader({ alg: "HS256", typ: "wotta+quote" }).setIssuedAt().setExpirationTime(expiresAt).sign(new TextEncoder().encode(config.env.RESOLVER_SIGNING_KEY));
  const { data: updated, error } = await db.from("intents").update({ quote: { quote, signature }, state: "quoted", version: 1, updated_at: new Date().toISOString() }).eq("id", intent.id).eq("owner_id", ownerId).eq("state", "draft").eq("version", 0).select("id").maybeSingle(); if (error) throw error; if (!updated) throw new Error("version_conflict");
  await appendEvent(db, intent.id, "draft", "quoted", 1, {}, { quoteId }); return { quote, signature };
}

/** Soft finality (1000) settles much faster on EVM/Solana testnets. Stellar CCTP requires 2000. */
function cctpFinalityThreshold(routeId: string): 1000 | 2000 {
  return routeId === "stellar" ? 2000 : 1000;
}

function buildSourcePlan(config: Config, input: Record<string, unknown>, grossDebit: bigint, maxFee: bigint, minFinalityThreshold: 1000 | 2000) {
  const routeId = String(input.routeId) as "ethereum" | "arbitrum" | "base" | "solana" | "stellar";
  const denomination = String(input.denomination) as keyof typeof DENOMINATION_CODES;
  const escrow = config.manifest.pools.find((pool) => pool.denomination === denomination);
  if (!escrow || !/^0x[0-9a-f]+$/i.test(config.manifest.router.address)) throw new Error("route_disabled:missing_router_or_pool");
  if (!input.publicRefundRecipient) throw new Error("invalid_public_refund_recipient");
  const hook = {
    intentId: String(input.id), denominationCode: DENOMINATION_CODES[denomination], escrowPool: escrow.address,
    claimHash: String(input.claimHash), publicRefundRecipient: String(input.publicRefundRecipient),
    expiresAt: BigInt(Math.floor(Date.parse(String(input.expiresAt)) / 1000)), manifestVersion: 1,
  };
  const common = { router: config.manifest.router.address as `0x${string}`, amount: grossDebit, hook, maxFee, minFinalityThreshold };
  return routeId === "solana" || routeId === "stellar"
    ? buildNonEvmCctpBurnPlan({ ...common, route: routeId })
    : buildEvmCctpBurnCalls({ ...common, route: routeId });
}
export function requestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
