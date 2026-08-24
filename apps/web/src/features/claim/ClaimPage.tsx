"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClaimView } from "@/components/claim/ClaimView";
import { PageShell } from "@/components/PageShell";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { WrongModeNotice } from "@/components/WrongModeNotice";

function ClaimPageInner({ embedded = false }: { embedded?: boolean }) {
  const { mode } = useNetworkMode();
  const params = useSearchParams();
  const noteId = params.get("noteId");

  if (mode === "mainnet") {
    const unavailable = (
      <WrongModeNotice
        feature="Claim"
        detail="Not available on Mainnet. Mainnet sends directly between registered Ready private balances; switch to Testnet beta for escrow claims."
      />
    );
    return embedded ? unavailable : (
      <PageShell title="Claim" subtitle="Prove and claim USDC from your inbox into your private Starknet balance.">{unavailable}</PageShell>
    );
  }

  if (embedded) {
    return <ClaimView embedded noteId={noteId} />;
  }

  return (
    <PageShell
      title="Claim"
      subtitle="Prove and claim USDC from your inbox into your private Starknet balance."
    >
      <ClaimView noteId={noteId} />
    </PageShell>
  );
}

export function ClaimPage({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <Suspense fallback={embedded ? <NoteCardSkeleton /> : null}>
      <ClaimPageInner embedded={embedded} />
    </Suspense>
  );
}
