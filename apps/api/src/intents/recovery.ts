import type { IntentState } from "@wotta/shared";
import { INTENT_STATES } from "@wotta/shared";
import type { Db } from "../db/client.ts";
import { getIntent, transition, transitionAllowed } from "./service.ts";

export type RecoveryHint =
  | "awaiting_attestation"
  | "self_settle"
  | "awaiting_claim"
  | "awaiting_refund"
  | "failed_recoverable"
  | "none";

const SELF_SETTLE_MS = 15 * 60 * 1000;

/** Shortest allowed transition path from `from` to `target` (exclusive of `from`). */
export function pathToward(from: IntentState, target: IntentState): IntentState[] {
  if (from === target) return [];
  const queue: IntentState[][] = [[from]];
  const seen = new Set<IntentState>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of INTENT_STATES) {
      if (!transitionAllowed(last, next) || seen.has(next)) continue;
      const nextPath = path.concat(next);
      if (next === target) return nextPath.slice(1);
      seen.add(next);
      queue.push(nextPath);
    }
  }
  throw new Error("invalid_transition");
}

export async function transitionToward(
  db: Db,
  ownerId: string,
  intentId: string,
  expectedVersion: number,
  from: IntentState,
  target: IntentState,
  evidence: Record<string, unknown> = {},
  chainId?: string,
) {
  const steps = pathToward(from, target);
  let version = expectedVersion;
  let state = from;
  let row = await getIntent(db, ownerId, intentId, chainId);
  for (const to of steps) {
    row = await transition(db, ownerId, intentId, version, to, evidence);
    version = row.version as number;
    state = row.state as IntentState;
  }
  return { ...row, state, version };
}

export async function applyOnchainProjection(
  db: Db,
  chainId: string,
  claimHash: string,
  kind: "funded" | "claimed" | "refunded",
) {
  const { data: intent, error } = await db
    .from("intents")
    .select("id,owner_id,state,version,source_tx_hash,onchain_state,expires_at")
    .eq("claim_hash", claimHash)
    .eq("chain_id", chainId)
    .maybeSingle();
  if (error) throw error;
  if (!intent) return null;
  const state = intent.state as IntentState;
  if (state === "claimed" || state === "completed" || state === "refunded" || state === "failed_terminal") return intent;
  const target: IntentState = kind === "funded" ? "funded" : kind === "claimed" ? "claimed" : "refunded";
  if (state === target) return intent;
  try {
    return await transitionToward(db, intent.owner_id, intent.id, intent.version, state, target, { onchain: kind }, chainId);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_transition") return intent;
    throw error;
  }
}

export async function sweepExpiredFunded(db: Db, chainId: string, now = new Date()) {
  const { data, error } = await db
    .from("intents")
    .select("id,owner_id,state,version")
    .eq("chain_id", chainId)
    .eq("onchain_state", "funded")
    .lt("expires_at", now.toISOString())
    .in("state", ["source_submitted", "source_confirmed", "attestation_ready", "destination_submitted", "funded", "delivered", "claimable", "failed_recoverable"]);
  if (error) throw error;
  let swept = 0;
  for (const intent of data ?? []) {
    try {
      await transitionToward(
        db,
        intent.owner_id,
        intent.id,
        intent.version,
        intent.state as IntentState,
        "refundable",
        { reason: "escrow_expired" },
        chainId,
      );
      swept += 1;
    } catch {
      // Skip rows that cannot walk to refundable from their current state.
    }
  }
  return swept;
}

export async function cancelIntent(db: Db, ownerId: string, intentId: string, expectedVersion: number) {
  const current = await getIntent(db, ownerId, intentId);
  if (current.source_tx_hash) throw new Error("invalid_cancel_after_burn");
  if (current.version !== expectedVersion) throw new Error("version_conflict");
  if (current.state !== "draft" && current.state !== "quoted") throw new Error("invalid_transition");
  return transition(db, ownerId, intentId, expectedVersion, "failed_terminal", { cancelled: true });
}

export function recoveryHintFor(input: {
  state: IntentState;
  onchain_state?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  route_id?: string | null;
  jobCreatedAt?: string | null;
}): RecoveryHint {
  if (input.route_id === "starknet-public") return "none";
  if (input.state === "failed_recoverable") return "failed_recoverable";
  if (input.state === "expired" || input.state === "refundable") return "awaiting_refund";
  if (
    (input.state === "funded" || input.state === "delivered" || input.state === "claimable")
    && input.onchain_state !== "claimed"
    && input.onchain_state !== "refunded"
  ) {
    return "awaiting_claim";
  }
  if (input.state === "attestation_ready" || input.state === "destination_submitted") {
    const anchor = input.jobCreatedAt ?? input.updated_at ?? input.created_at;
    if (anchor && Date.now() - Date.parse(anchor) >= SELF_SETTLE_MS) return "self_settle";
    return "awaiting_attestation";
  }
  if (input.state === "source_submitted" || input.state === "source_confirmed") return "awaiting_attestation";
  return "none";
}
