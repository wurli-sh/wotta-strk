"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClaimView } from "@/components/claim/ClaimView";
import { PageShell } from "@/components/PageShell";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { WrongModeNotice } from "@/components/WrongModeNotice";
import { useRoutesHealth } from "@/features/send/useRoutesHealth";

function ClaimPageInner({ embedded = false }: { embedded?: boolean }) {
  const { mode } = useNetworkMode();
  const params = useSearchParams();
  const noteId = params.get("noteId");
  const { routes, routesReady } = useRoutesHealth(mode, mode === "mainnet");
  const mainnetEscrowReady = routes.some((route) => route.key === "starknet-private" && route.selectable);

  if (mode === "mainnet" && !routesReady) {
    return embedded ? <NoteCardSkeleton /> : (
      <PageShell title="Claim" subtitle="Checking the verified Mainnet escrow route."><NoteCardSkeleton /></PageShell>
    );
  }

  if (mode === "mainnet" && routesReady && !mainnetEscrowReady) {
    const unavailable = (
      <WrongModeNotice
        feature="Claim"
        detail="Mainnet escrow claims stay disabled until the Wotta escrow and Ready privacy manifests pass on-chain verification."
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
