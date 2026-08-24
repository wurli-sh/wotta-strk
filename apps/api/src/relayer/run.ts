import { CairoByteArray, Account, RpcProvider, Signer, type Call, type ResourceBoundsBN } from "starknet";
import { decodeCircleCctpMessageV2, DENOMINATION_CODES, type IntentState } from "@wotta/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Logger } from "pino";
import { acquireLease } from "../workers/lease.ts";
import { routeById } from "../routes.ts";
import { fetchAttestation } from "./iris.ts";
import { transition, transitionAllowed } from "../intents/service.ts";

const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
/** CCTP settle is cheaper than privacy apply_actions; keep a floor so we fail loud when empty. */
const SETTLE_MIN_L2_GAS = 30_000_000n;

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

function feltBytes32(value: string): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`.toLowerCase();
}

function relayerAccount(config: Config) {
  const address = config.env.STARKNET_RELAYER_ADDRESS ?? config.env.STARKNET_DEPLOYER_ADDRESS;
  const rawKey = config.env.STARKNET_RELAYER_PRIVATE_KEY ?? config.env.STARKNET_RELAYER_KEY_OR_KEYSTORE ?? config.env.STARKNET_DEPLOYER_PRIVATE_KEY;
  const key = rawKey && !rawKey.startsWith("0x") ? `0x${rawKey}` : rawKey;
  if (!address || !key || !/^0x[0-9a-f]+$/i.test(key)) throw new Error("relayer_credentials_missing");
  const provider = new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL });
  return { provider, account: new Account({ provider, address, signer: new Signer(key) }) };
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
      `relayer STRK balance too low on Sepolia — fund STARKNET_RELAYER_ADDRESS / STARKNET_DEPLOYER_ADDRESS (${accountAddress}) with at least 10 STRK`,
    );
  }
  const l2Price = bounds.l2_gas.max_price_per_unit;
  const affordableL2 = l2Price > 0n ? (budget - reserved) / l2Price : 0n;
  const l2Max = affordableL2 < bounds.l2_gas.max_amount ? affordableL2 : bounds.l2_gas.max_amount;
  if (l2Max < SETTLE_MIN_L2_GAS) {
    throw new Error(
      `relayer STRK balance too low on Sepolia — fund STARKNET_RELAYER_ADDRESS / STARKNET_DEPLOYER_ADDRESS (${accountAddress}) with at least 10 STRK`,
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

function validateSettlement(config: Config, job: JobRow, message: string) {
  const decoded = decodeCircleCctpMessageV2(message);
  const route = routeById(job.intent.route_id, config);
  if (!route?.enabled || route.domain !== decoded.sourceDomain) throw new Error("settlement_source_mismatch");
  if (decoded.destinationDomain !== 25) throw new Error("settlement_destination_mismatch");
  const router = feltBytes32(config.manifest.router.address);
  if (decoded.destinationCaller.toLowerCase() !== router || decoded.burn.mintRecipient.toLowerCase() !== router) throw new Error("settlement_router_mismatch");
  if (decoded.wrapper.hook.intentId !== job.intent.id) throw new Error("settlement_intent_mismatch");
  const pool = config.manifest.pools.find((candidate) => String(candidate.denomination) === String(job.intent.denomination));
  if (!pool || decoded.wrapper.hook.escrowPool.toLowerCase() !== feltBytes32(pool.address)) throw new Error("settlement_pool_mismatch");
  const denomination = String(job.intent.denomination) as keyof typeof DENOMINATION_CODES;
  if (decoded.wrapper.hook.denominationCode !== DENOMINATION_CODES[denomination]) throw new Error("settlement_denomination_mismatch");
  if (decoded.wrapper.hook.claimHash.toLowerCase() !== feltBytes32(job.intent.claim_hash)) throw new Error("settlement_claim_mismatch");
  if (decoded.wrapper.hook.publicRefundRecipient.toLowerCase() !== feltBytes32(job.intent.public_refund_recipient)) throw new Error("settlement_refund_mismatch");
  if (decoded.wrapper.hook.expiresAt !== BigInt(Math.floor(Date.parse(job.intent.expires_at) / 1000))) throw new Error("settlement_expiry_mismatch");
  if (decoded.wrapper.hook.manifestVersion !== 1) throw new Error("settlement_manifest_mismatch");
  const signedQuote = job.intent.quote?.quote;
  if (!signedQuote?.grossDebit || signedQuote.maxFee === undefined || signedQuote.minFinalityThreshold === undefined) throw new Error("settlement_quote_missing");
  if (decoded.burn.amount !== BigInt(signedQuote.grossDebit) || decoded.burn.maxFee !== BigInt(signedQuote.maxFee)) throw new Error("settlement_fee_binding_mismatch");
  if (decoded.burn.feeExecuted > decoded.burn.maxFee || decoded.burn.amount - decoded.burn.feeExecuted < BigInt(job.intent.denomination)) throw new Error("settlement_underfunded");
  if (decoded.minFinalityThreshold !== signedQuote.minFinalityThreshold || decoded.finalityThresholdExecuted < decoded.minFinalityThreshold) throw new Error("settlement_finality_mismatch");
  return decoded;
}

async function advance(db: Db, job: JobRow, to: IntentState, evidence: Record<string, unknown>) {
  const updated = await transition(db, job.intent.owner_id, job.intent.id, job.intent.version, to, evidence);
  job.intent.state = updated.state as IntentState;
  job.intent.version = updated.version as number;
}

async function processJob(deps: { db: Db; config: Config; log: Logger }, job: JobRow) {
  const route = routeById(job.intent.route_id, deps.config);
  if (!route?.enabled || route.domain === null || !job.intent.source_tx_hash) throw new Error("relayer_route_invalid");
  const iris = await fetchAttestation(deps.config, route.domain, job.intent.source_tx_hash);
  if (!iris) {
    deps.log.info({ intentId: job.intent.id, sourceTxHash: job.intent.source_tx_hash, route: job.intent.route_id }, "Waiting for Circle Iris attestation");
    return false;
  }
  validateSettlement(deps.config, job, iris.message);

  if (job.intent.state === "source_submitted") await advance(deps.db, job, "source_confirmed", { sourceTxHash: job.intent.source_tx_hash });
  if (job.intent.state === "source_confirmed") await advance(deps.db, job, "attestation_ready", { messageHash: iris.messageHash });
  const { provider, account } = relayerAccount(deps.config);
  if (job.intent.state === "attestation_ready" && !job.destination_tx_hash) {
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
  if (job.intent.state === "attestation_ready" && job.destination_tx_hash) {
    await advance(deps.db, job, "destination_submitted", { destinationTxHash: job.destination_tx_hash, messageHash: iris.messageHash, recovered: true });
  }
  if (!job.destination_tx_hash) throw new Error("destination_transaction_missing");
  await provider.waitForTransaction(job.destination_tx_hash);
  if (job.intent.state === "destination_submitted") await advance(deps.db, job, "funded", { destinationTxHash: job.destination_tx_hash, messageHash: iris.messageHash });
  if (job.intent.state === "funded") {
    const [{ data: registered }, { data: pending }] = await Promise.all([
      deps.db.from("encrypted_notes").select("id").eq("intent_id", job.intent.id).limit(1),
      deps.db.from("pending_claims").select("id").eq("intent_id", job.intent.id).limit(1),
    ]);
    if ((registered?.length ?? 0) + (pending?.length ?? 0) > 0) {
      await advance(deps.db, job, "delivered", { encryptedDelivery: true });
    }
  }
  await deps.db.from("relayer_jobs").update({ status: "succeeded", message_hash: iris.messageHash, last_error: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  deps.log.info({ intentId: job.intent.id, destinationTxHash: job.destination_tx_hash }, "CCTP intent settled on Starknet");
  return true;
}

export async function runRelayerOnce(deps: { db: Db; config: Config; log: Logger }) {
  const lease = await acquireLease(deps.db, "relayer");
  if (!lease) return { processed: 0, leased: false };
  const { data, error } = await deps.db.from("relayer_jobs").select("id,attempts,destination_tx_hash,intent:intents!inner(id,owner_id,state,version,route_id,denomination,source_tx_hash,claim_hash,public_refund_recipient,expires_at,quote)").eq("status", "queued").order("created_at").limit(10);
  if (error) throw error;
  let processed = 0;
  for (const raw of data ?? []) {
    const job = raw as unknown as JobRow;
    try {
      const done = await processJob(deps, job);
      if (done) processed += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "relayer_failed";
      const feeExhausted = isRelayerFeeExhausted(message);
      const terminal = attempts >= 10 || feeExhausted;
      await deps.db.from("relayer_jobs").update({ status: terminal ? "failed" : "queued", attempts, last_error: message.slice(0, 512), updated_at: new Date().toISOString() }).eq("id", job.id);
      if (feeExhausted && transitionAllowed(job.intent.state, "failed_recoverable")) {
        try {
          await advance(deps.db, job, "failed_recoverable", {
            reason: "relayer_strk_insufficient",
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
  while (!signal.aborted) {
    await runRelayerOnce(deps);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
