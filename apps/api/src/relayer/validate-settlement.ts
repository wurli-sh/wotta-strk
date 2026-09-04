import {
  CIRCLE_ROUTE_REGISTRY,
  CIRCLE_STARKNET_TOKEN_MESSENGER,
  type CircleEnvironment,
  type WottaSourceRoute,
} from "@wotta/adapters";
import { decodeCircleCctpMessageV2, DENOMINATION_CODES, type IntentState } from "@wotta/shared";
import type { Config } from "../config.ts";
import { cctpPoolsForConfig, routeById } from "../routes.ts";

export type SettlementJob = {
  intent: {
    id: string;
    state: IntentState;
    route_id: string;
    denomination: string | number;
    claim_hash: string;
    public_refund_recipient: string;
    expires_at: string;
    quote: { quote?: { grossDebit?: string; maxFee?: string; minFinalityThreshold?: number } } | null;
  };
};

export function feltBytes32(value: string): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`.toLowerCase();
}

function circleRouteForJob(config: Config, routeId: string) {
  const env: CircleEnvironment = config.manifest.chainId === "SN_MAIN" ? "mainnet" : "testnet";
  return CIRCLE_ROUTE_REGISTRY[env][routeId as WottaSourceRoute];
}

export function validateSettlement(config: Config, job: SettlementJob, message: string | Uint8Array) {
  const decoded = decodeCircleCctpMessageV2(message);
  const route = routeById(job.intent.route_id, config);
  if (!route?.enabled || route.domain !== decoded.sourceDomain) throw new Error("settlement_source_mismatch");
  if (decoded.destinationDomain !== 25) throw new Error("settlement_destination_mismatch");
  const router = feltBytes32(config.manifest.router.address);
  if (decoded.destinationCaller.toLowerCase() !== router || decoded.burn.mintRecipient.toLowerCase() !== router) {
    throw new Error("settlement_router_mismatch");
  }
  const circle = circleRouteForJob(config, job.intent.route_id);
  const env: CircleEnvironment = config.manifest.chainId === "SN_MAIN" ? "mainnet" : "testnet";
  if (decoded.recipient.toLowerCase() !== feltBytes32(CIRCLE_STARKNET_TOKEN_MESSENGER[env])) {
    throw new Error("settlement_recipient_mismatch");
  }
  if (circle?.family === "evm" && decoded.burn.burnToken.toLowerCase() !== feltBytes32(circle.usdc)) {
    throw new Error("settlement_burn_token_mismatch");
  }
  if (circle?.family === "solana" && decoded.burn.burnToken.toLowerCase() !== circle.burnTokenBytes32?.toLowerCase()) {
    throw new Error("settlement_burn_token_mismatch");
  }
  if (decoded.wrapper.hook.intentId !== job.intent.id) throw new Error("settlement_intent_mismatch");
  const pool = cctpPoolsForConfig(config).find((candidate) => String(candidate.denomination) === String(job.intent.denomination));
  if (!pool || decoded.wrapper.hook.escrowPool.toLowerCase() !== feltBytes32(pool.address)) throw new Error("settlement_pool_mismatch");
  const denomination = String(job.intent.denomination) as keyof typeof DENOMINATION_CODES;
  if (decoded.wrapper.hook.denominationCode !== DENOMINATION_CODES[denomination]) throw new Error("settlement_denomination_mismatch");
  if (decoded.wrapper.hook.claimHash.toLowerCase() !== feltBytes32(job.intent.claim_hash)) throw new Error("settlement_claim_mismatch");
  if (decoded.wrapper.hook.publicRefundRecipient.toLowerCase() !== feltBytes32(job.intent.public_refund_recipient)) throw new Error("settlement_refund_mismatch");
  if (decoded.wrapper.hook.expiresAt !== BigInt(Math.floor(Date.parse(job.intent.expires_at) / 1000))) throw new Error("settlement_expiry_mismatch");
  if (decoded.wrapper.hook.manifestVersion !== 1) throw new Error("settlement_manifest_mismatch");
  const signedQuote = job.intent.quote?.quote;
  if (!signedQuote?.grossDebit || signedQuote.maxFee === undefined || signedQuote.minFinalityThreshold === undefined) {
    throw new Error("settlement_quote_missing");
  }
  if (decoded.burn.amount !== BigInt(signedQuote.grossDebit) || decoded.burn.maxFee !== BigInt(signedQuote.maxFee)) {
    throw new Error("settlement_fee_binding_mismatch");
  }
  if (decoded.burn.feeExecuted > decoded.burn.maxFee || decoded.burn.amount - decoded.burn.feeExecuted < BigInt(job.intent.denomination)) {
    throw new Error("settlement_underfunded");
  }
  if (decoded.minFinalityThreshold !== signedQuote.minFinalityThreshold || decoded.finalityThresholdExecuted < decoded.minFinalityThreshold) {
    throw new Error("settlement_finality_mismatch");
  }
  return decoded;
}
