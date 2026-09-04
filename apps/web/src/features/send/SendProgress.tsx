"use client";

import { TextShimmer } from "@/components/ui/TextShimmer";
import type { FundingStage } from "@/lib/wotta/product-session";
import type { ProofPhase } from "@/lib/wotta/privacy-proof";

type SendStage = "idle" | FundingStage | ProofPhase | "unlocking_private" | "complete";

const LABELS: Partial<Record<SendStage, string>> = {
  resolving: "Resolving recipient…",
  quoting: "Verifying quote…",
  approving: "Approve USDC…",
  depositing: "Deposit to Wotta…",
  submitting: "Submitting proof…",
  delivering: "Encrypting delivery…",
  connecting_source: "Connecting source wallet…",
  burning: "Confirm CCTP burn…",
  confirming: "Confirming source transaction…",
  attesting: "Waiting for Circle attestation…",
  settling: "Settling privately on Starknet…",
  unlocking_private: "Unlocking private balance…",
  waiting_confirmations: "Waiting for a proof-safe block…",
  building_proof: "Building private transfer…",
  signing_message: "Authorize in wallet…",
  generating_proof: "Generating private proof…",
};

export function SendProgress({ stage }: { stage: SendStage }) {
  const label = LABELS[stage];
  if (!label) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <TextShimmer>{label}</TextShimmer>
    </p>
  );
}
