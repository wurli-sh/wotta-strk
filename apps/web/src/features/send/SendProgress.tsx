"use client";

import { TextShimmer } from "@/components/ui/TextShimmer";
import type { FundingStage } from "@/lib/wotta/product-session";
import type { ProofPhase } from "@/lib/wotta/privacy-proof";

type SendStage = "idle" | FundingStage | ProofPhase | "unlocking_private" | "complete";

const LABELS: Partial<Record<SendStage, string>> = {
  resolving: "Looking up recipient…",
  quoting: "Fetching quote…",
  approving: "Waiting for approval…",
  submitting: "Confirm source payment…",
  delivering: "Saving encrypted delivery…",
  connecting_source: "Connecting source wallet…",
  burning: "Confirm source burn…",
  confirming: "Confirming source transaction…",
  settling: "Settling on Starknet…",
  unlocking_private: "Unlocking private balance…",
  waiting_confirmations: "Waiting for a proof-safe block…",
  building_proof: "Building private transfer…",
  signing_message: "Authorize in Ready…",
  generating_proof: "Generating privacy proof…",
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
