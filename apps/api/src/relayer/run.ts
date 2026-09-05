import { CairoByteArray, Account, RpcProvider, Signer, type Call, type ResourceBoundsBN } from "starknet";
import { type IntentState } from "@wotta/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Logger } from "pino";
import { acquireLease } from "../workers/lease.ts";
import { routeById } from "../routes.ts";
import { fetchAttestationWithBackoff } from "./iris.ts";
import { transition, transitionAllowed } from "../intents/service.ts";
import { transitionToward } from "../intents/recovery.ts";
import { validateSettlement } from "./validate-settlement.ts";
import { resolveRelayerCredentials, STRK_TOKEN_ADDRESS } from "./readiness.ts";

/** CCTP settle is cheaper than privacy apply_actions; keep a floor so we fail loud when empty. */
const SETTLE_MIN_L2_GAS = 30_000_000n;
const PROJECTION_WAIT_ATTEMPTS = 6;
const PROJECTION_WAIT_MS = 1_500;
const STALE_PROCESSING_MS = 10 * 60 * 1_000;

type JobRow = {
  id: string;
  attempts: number;
  destination_tx_hash: string | null;
  intent: {
    id: string;
    owner_id: string;
    state: IntentState;
    version: number;
    route_id: string;
    denomination: string | number;
    source_tx_hash: string;
    claim_hash: string;
    public_refund_recipient: string;
    expires_at: string;
    quote: { quote?: { grossDebit?: string; maxFee?: string; minFinalityThreshold?: number } } | null;
  };
};

function intentIdFelt(intentId: string): string {
  return `0x${intentId.replaceAll("-", "").toLowerCase()}`;
}

async function routerProcessed(provider: RpcProvider, config: Config, intentId: string): Promise<boolean> {
  const result = await provider.callContract({
    contractAddress: config.manifest.router.address,
    entrypoint: "processed",
    calldata: [intentIdFelt(intentId)],
  });
  return BigInt(result[0] ?? 0) !== 0n;
}

async function waitForOnchainProjection(db: Db, config: Config, claimHash: string): Promise<string | null> {
  for (let attempt = 0; attempt < PROJECTION_WAIT_ATTEMPTS; attempt += 1) {
    const { data, error } = await db.from("intents").select("onchain_state,onchain_tx_hash").eq("claim_hash", claimHash).eq("chain_id", config.manifest.chainId).maybeSingle();
    if (error) throw error;
    if (data?.onchain_state === "funded" || data?.onchain_state === "claimed" || data?.onchain_state === "refunded") {
      return data.onchain_tx_hash ?? null;
    }
    await new Promise((resolve) => setTimeout(resolve, PROJECTION_WAIT_MS));
  }
  return null;
}

async function refreshJobState(db: Db, config: Config, job: JobRow): Promise<void> {
  const { data, error } = await db
    .from("intents")
    .select("state,version")
    .eq("id", job.intent.id)
    .eq("chain_id", config.manifest.chainId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("relayer_intent_missing");
  job.intent.state = data.state as IntentState;
  job.intent.version = data.version as number;
}

async function relayerAccount(config: Config) {
  const { provider, address, privateKey } = await resolveRelayerCredentials(config);
  return { provider, account: new Account({ provider, address, signer: new Signer(privateKey) }) };
}

function relayerFallbackProvider(config: Config): RpcProvider | undefined {
  const url = config.env.STARKNET_FALLBACK_RPC_URL;
  return url ? new RpcProvider({ nodeUrl: url }) : undefined;
}

async function strkBalance(account: Account): Promise<bigint> {
  const result = await account.provider.callContract({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "balanceOf",
    calldata: [account.address],
  });
  return BigInt(result[0] ?? 0) + (BigInt(result[1] ?? 0) << 128n);
}

function maxFeeForBounds(bounds: ResourceBoundsBN): bigint {
  const l1 = bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit;
  const l2 = bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit;
  const l1Data = bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit;
  return l1 + l2 + l1Data;
}

/** Shrink L2 max_amount so total max fee fits ~95% of STRK balance (auto-estimates often overshoot). */
function clampBoundsToBalance(bounds: ResourceBoundsBN, balance: bigint, accountAddress: string): ResourceBoundsBN {
  const budget = (balance * 95n) / 100n;
  const l1Cost = bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit;
  const l1DataCost = bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit;
  const reserved = l1Cost + l1DataCost;
  if (budget <= reserved) {
    throw new Error(
      `relayer STRK balance too low — fund STARKNET_RELAYER_ADDRESS / STARKNET_DEPLOYER_ADDRESS (${accountAddress}) with at least 10 STRK`,
    );
  }
  const l2Price = bounds.l2_gas.max_price_per_unit;
  const affordableL2 = l2Price > 0n ? (budget - reserved) / l2Price : 0n;
  const l2Max = affordableL2 < bounds.l2_gas.max_amount ? affordableL2 : bounds.l2_gas.max_amount;
  if (l2Max < SETTLE_MIN_L2_GAS) {
    throw new Error(
      `relayer STRK balance too low — fund STARKNET_RELAYER_ADDRESS / STARKNET_DEPLOYER_ADDRESS (${accountAddress}) with at least 10 STRK`,
    );
  }
  return {
    ...bounds,
    l2_gas: { ...bounds.l2_gas, max_amount: l2Max },
  };
}

async function executeSettle(account: Account, call: Call) {
  const estimated = await account.estimateInvokeFee(call);
  const balance = await strkBalance(account);
  let resourceBounds = estimated.resourceBounds;
  if (maxFeeForBounds(resourceBounds) > (balance * 95n) / 100n) {
    resourceBounds = clampBoundsToBalance(resourceBounds, balance, account.address);
  }
  return account.execute(call, { resourceBounds });
}

function isRelayerFeeExhausted(message: string): boolean {
  return /exceed balance|strk balance too low|resources bounds/i.test(message);
}

function isRelayerSignerInvalid(message: string): boolean {
  return /account validation failed|invalid signature length/i.test(message);
}

async function advance(db: Db, job: JobRow, to: IntentState, evidence: Record<string, unknown>) {
  const updated = await transition(db, job.intent.owner_id, job.intent.id, job.intent.version, to, evidence);
  job.intent.state = updated.state as IntentState;
  job.intent.version = updated.version as number;
}

async function deliverRegisteredNoteIfReady(deps: { db: Db; config: Config }, job: JobRow): Promise<void> {
  if (job.intent.state !== "funded") return;
  const [{ data: registered, error: registeredError }, { data: pending, error: pendingError }] = await Promise.all([
    deps.db.from("encrypted_notes").select("id").eq("intent_id", job.intent.id).eq("chain_id", deps.config.manifest.chainId).limit(1),
    deps.db.from("pending_claims").select("id").eq("intent_id", job.intent.id).limit(1),
  ]);
  if (registeredError) throw registeredError;
  if (pendingError) throw pendingError;
  if ((registered?.length ?? 0) + (pending?.length ?? 0) > 0) {
    await advance(deps.db, job, "delivered", { encryptedDelivery: true });
  }
}

export async function processJob(deps: { db: Db; config: Config; log: Logger }, job: JobRow) {
  const route = routeById(job.intent.route_id, deps.config);
  if (!route?.enabled || route.domain === null || !job.intent.source_tx_hash) throw new Error("relayer_route_invalid");
  const { data: projection, error: projectionError } = await deps.db.from("intents").select("onchain_state,onchain_tx_hash").eq("id", job.intent.id).eq("chain_id", deps.config.manifest.chainId).maybeSingle();
  if (projectionError) throw projectionError;
  if (projection && ["funded", "claimed", "refunded"].includes(projection.onchain_state)) {
    await refreshJobState(deps.db, deps.config, job);
    if (projection.onchain_state === "funded" && ["attestation_ready", "destination_submitted", "failed_recoverable"].includes(job.intent.state)) {
      const updated = await transitionToward(
        deps.db,
        job.intent.owner_id,
        job.intent.id,
        job.intent.version,
        job.intent.state,
        "funded",
        { recovered: true, destinationTxHash: projection.onchain_tx_hash },
      );
      job.intent.state = updated.state as IntentState;
      job.intent.version = updated.version as number;
    }
    await deliverRegisteredNoteIfReady(deps, job);
    const { error } = await deps.db.from("relayer_jobs").update({ status: "succeeded", destination_tx_hash: job.destination_tx_hash ?? projection.onchain_tx_hash, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    if (error) throw error;
    return true;
  }
  const iris = await fetchAttestationWithBackoff(deps.config, route.domain, job.intent.source_tx_hash);
  if (!iris) {
    deps.log.info({ intentId: job.intent.id, sourceTxHash: job.intent.source_tx_hash, route: job.intent.route_id }, "Waiting for Circle Iris attestation");
    return false;
  }
  validateSettlement(deps.config, job, iris.message);

  // Recoverable jobs must re-enter settlement, not fall through to `funded`
  // merely because no destination hash has been stored yet.
  if (job.intent.state === "failed_recoverable") {
    await advance(deps.db, job, "attestation_ready", { messageHash: iris.messageHash, recovered: true });
  }
  if (job.intent.state === "source_submitted") await advance(deps.db, job, "source_confirmed", { sourceTxHash: job.intent.source_tx_hash });
  if (job.intent.state === "source_confirmed") await advance(deps.db, job, "attestation_ready", { messageHash: iris.messageHash });
  const { provider, account } = await relayerAccount(deps.config);
  // Proactive STRK balance alert before attempting settlement
  const currentBalance = await strkBalance(account);
  if (currentBalance < deps.config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI) {
    deps.log.warn(
      { balance: currentBalance.toString(), address: account.address },
      "relayer STRK balance below alert threshold — fund before exhaustion",
    );
  }
  let settlementVerified = false;
  if (job.intent.state === "attestation_ready" && !job.destination_tx_hash) {
    const { data: projected } = await deps.db.from("intents").select("onchain_state,onchain_tx_hash").eq("id", job.intent.id).eq("chain_id", deps.config.manifest.chainId).maybeSingle();
    const alreadyOnchain = projected?.onchain_state === "funded" || projected?.onchain_state === "claimed" || projected?.onchain_state === "refunded";
    const alreadyProcessed = alreadyOnchain || await routerProcessed(provider, deps.config, job.intent.id);
    if (alreadyProcessed) {
      settlementVerified = true;
      job.destination_tx_hash = projected?.onchain_tx_hash ?? job.destination_tx_hash;
      if (!job.destination_tx_hash) {
        job.destination_tx_hash = await waitForOnchainProjection(deps.db, deps.config, job.intent.claim_hash);
      }
      if (job.destination_tx_hash) {
        await deps.db.from("relayer_jobs").update({ destination_tx_hash: job.destination_tx_hash, message_hash: iris.messageHash, updated_at: new Date().toISOString() }).eq("id", job.id);
      }
      await refreshJobState(deps.db, deps.config, job);
      if (job.intent.state === "attestation_ready" || job.intent.state === "failed_recoverable") {
        await advance(deps.db, job, "destination_submitted", {
          destinationTxHash: job.destination_tx_hash,
          messageHash: iris.messageHash,
          recovered: true,
        });
      }
    } else {
      const message = new CairoByteArray(Buffer.from(iris.message.replace(/^0x/, ""), "hex"));
      const attestation = new CairoByteArray(Buffer.from(iris.attestation.replace(/^0x/, ""), "hex"));
      const call = {
        contractAddress: deps.config.manifest.router.address,
        entrypoint: "settle",
        calldata: [...message.toApiRequest(), ...attestation.toApiRequest()],
      };
      const response = await executeSettle(account, call);
      job.destination_tx_hash = response.transaction_hash;
      await deps.db.from("relayer_jobs").update({ destination_tx_hash: response.transaction_hash, message_hash: iris.messageHash, updated_at: new Date().toISOString() }).eq("id", job.id);
      await advance(deps.db, job, "destination_submitted", { destinationTxHash: response.transaction_hash, messageHash: iris.messageHash });
    }
  }
  if (job.intent.state === "attestation_ready" && job.destination_tx_hash) {
    await advance(deps.db, job, "destination_submitted", { destinationTxHash: job.destination_tx_hash, messageHash: iris.messageHash, recovered: true });
  }
  if (!job.destination_tx_hash) {
    if (!settlementVerified) throw new Error("settlement_confirmation_missing");
    const updated = await transitionToward(
      deps.db,
      job.intent.owner_id,
      job.intent.id,
      job.intent.version,
      job.intent.state,
      "funded",
      { recovered: true, messageHash: iris.messageHash },
    );
    job.intent.state = updated.state as IntentState;
    job.intent.version = updated.version as number;
    await deps.db.from("relayer_jobs").update({ status: "succeeded", message_hash: iris.messageHash, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    deps.log.info({ intentId: job.intent.id, recovered: true }, "CCTP intent already settled; workflow caught up without local destination hash");
    return true;
  }
  let receipt;
  try {
    receipt = await provider.waitForTransaction(job.destination_tx_hash);
  } catch (primaryError) {
    const fallback = relayerFallbackProvider(deps.config);
    if (!fallback) throw primaryError;
    deps.log.warn(
      { error: primaryError instanceof Error ? primaryError.message : String(primaryError) },
      "primary RPC failed for waitForTransaction, retrying on fallback",
    );
    receipt = await fallback.waitForTransaction(job.destination_tx_hash);
  }
  if (!receipt.isSuccess()) {
    // A reverted hash cannot succeed on the next poll. Clear it so a retry can
    // submit a fresh settlement instead of falsely marking the escrow funded.
    const { error } = await deps.db.from("relayer_jobs").update({ destination_tx_hash: null, updated_at: new Date().toISOString() }).eq("id", job.id);
    if (error) throw error;
    job.destination_tx_hash = null;
    await refreshJobState(deps.db, deps.config, job);
    if (transitionAllowed(job.intent.state, "failed_recoverable")) {
      await advance(deps.db, job, "failed_recoverable", { reason: "settlement_reverted" });
    }
    throw new Error("settlement_reverted");
  }
  await waitForOnchainProjection(deps.db, deps.config, job.intent.claim_hash);
  // The indexer can project `funded` while this worker waits for confirmation.
  // Refresh the optimistic-lock fields before attempting another transition.
  await refreshJobState(deps.db, deps.config, job);
  if (job.intent.state === "destination_submitted") {
    await transitionToward(
      deps.db,
      job.intent.owner_id,
      job.intent.id,
      job.intent.version,
      job.intent.state,
      "funded",
      { destinationTxHash: job.destination_tx_hash, messageHash: iris.messageHash },
    ).then((updated) => {
      job.intent.state = updated.state as IntentState;
      job.intent.version = updated.version as number;
    });
  }
  await deliverRegisteredNoteIfReady(deps, job);
  await deps.db.from("relayer_jobs").update({ status: "succeeded", message_hash: iris.messageHash, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  deps.log.info({ intentId: job.intent.id, destinationTxHash: job.destination_tx_hash }, "CCTP intent settled on Starknet");
  return true;
}

export async function runRelayerOnce(deps: { db: Db; config: Config; log: Logger }) {
  // Local Sepolia and Mainnet APIs may share one database; never let one chain
  // starve the other by contending for a global worker lease.
  const lease = await acquireLease(deps.db, `relayer:${deps.config.manifest.chainId}`);
  if (!lease) return { processed: 0, leased: false };
  // A process can die after atomically claiming a job. Only the matching
  // network worker may return an old processing claim to the queue.
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: stale, error: staleError } = await deps.db
    .from("relayer_jobs")
    .select("id,intent:intents!inner(chain_id)")
    .eq("status", "processing")
    .eq("intent.chain_id", deps.config.manifest.chainId)
    .lt("updated_at", staleBefore);
  if (staleError) throw staleError;
  for (const row of stale ?? []) {
    const { error: resetError } = await deps.db
      .from("relayer_jobs")
      .update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "processing")
      .lt("updated_at", staleBefore);
    if (resetError) throw resetError;
  }
  const { data, error } = await deps.db.from("relayer_jobs").select("id,attempts,destination_tx_hash,intent:intents!inner(id,owner_id,state,version,route_id,denomination,source_tx_hash,claim_hash,public_refund_recipient,expires_at,quote)").eq("status", "queued").eq("intent.chain_id", deps.config.manifest.chainId).order("created_at").limit(10);
  if (error) throw error;
  let processed = 0;
  for (const raw of data ?? []) {
    const job = raw as unknown as JobRow;
    // The global lease may expire during a slow Starknet confirmation. This
    // compare-and-set prevents another worker from executing the same job.
    const { data: claimed, error: claimError } = await deps.db
      .from("relayer_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;
    try {
      const done = await processJob(deps, job);
      if (done) {
        processed += 1;
      } else {
        const { error: releaseError } = await deps.db
          .from("relayer_jobs")
          .update({ status: "queued", updated_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("status", "processing");
        if (releaseError) throw releaseError;
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "relayer_failed";
      // RPC clients prefix failures with the full submitted transaction; retain
      // both ends so the actual node rejection remains visible in job recovery.
      const storedMessage = message.length > 512
        ? `${message.slice(0, 128)}…${message.slice(-383)}`
        : message;
      const feeExhausted = isRelayerFeeExhausted(message);
      const signerInvalid = isRelayerSignerInvalid(message);
      const terminal = attempts >= 10 || feeExhausted || signerInvalid;
      await deps.db.from("relayer_jobs").update({ status: terminal ? "failed" : "queued", attempts, last_error: storedMessage, updated_at: new Date().toISOString() }).eq("id", job.id);
      if ((feeExhausted || signerInvalid) && transitionAllowed(job.intent.state, "failed_recoverable")) {
        try {
          await advance(deps.db, job, "failed_recoverable", {
            reason: feeExhausted ? "relayer_strk_insufficient" : "relayer_signer_invalid",
            error: message.slice(0, 240),
          });
        } catch (transitionError) {
          deps.log.warn({
            intentId: job.intent.id,
            error: transitionError instanceof Error ? transitionError.message : "transition_failed",
          }, "Could not mark CCTP intent failed after relayer STRK exhaustion");
        }
      }
      deps.log.warn({ intentId: job.intent.id, attempts, error: message }, "CCTP settlement attempt failed");
    }
  }
  return { processed, queued: data?.length ?? 0 };
}

export async function runRelayerLoop(deps: { db: Db; config: Config; log: Logger }, signal: AbortSignal) {
  let idleBackoff = 5_000;
  while (!signal.aborted) {
    try {
      const result = await runRelayerOnce(deps);
      // Reset to 5 s when work was processed; otherwise double up to 120 s
      idleBackoff = result.processed > 0 ? 5_000 : Math.min(120_000, idleBackoff * 2);
    } catch (error) {
      deps.log.error({ error: error instanceof Error ? error.message : "relayer_failed" }, "Wotta relayer iteration failed");
      idleBackoff = Math.min(120_000, idleBackoff * 2);
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, idleBackoff + Math.floor(Math.random() * 1_000)),
    );
  }
}
