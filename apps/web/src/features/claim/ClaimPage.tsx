"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClaimView } from "@/components/claim/ClaimView";
import { PageShell } from "@/components/PageShell";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { WrongModeNotice } from "@/components/WrongModeNotice";
import { useRoutesHealth } from "@/features/send/useRoutesHealth";
import {
  CHECKING_PRIVATE_CLAIM_ROUTE,
  PAGE_SUBTITLES,
  PRIVATE_CLAIM_ROUTE_UNVERIFIED,
} from "@/lib/brand-copy";

function ClaimPageInner({ embedded = false }: { embedded?: boolean }) {
  const { mode } = useNetworkMode();
  const params = useSearchParams();
  const noteId = params.get("noteId");
  const { routes, routesReady } = useRoutesHealth(mode, mode === "mainnet");
  const privateRoute = routes.find((route) => route.key === "starknet-private");
  const mainnetEscrowReady = privateRoute?.selectable === true;

  if (mode === "mainnet" && !routesReady) {
    return embedded ? <NoteCardSkeleton /> : (
      <PageShell title="Claim" subtitle={CHECKING_PRIVATE_CLAIM_ROUTE}><NoteCardSkeleton /></PageShell>
    );
  }

  if (mode === "mainnet" && routesReady && !mainnetEscrowReady) {
    const unavailable = (
      <WrongModeNotice
        feature="Claim"
        detail={privateRoute?.reason ?? PRIVATE_CLAIM_ROUTE_UNVERIFIED}
      />
    );
    return embedded ? unavailable : (
      <PageShell title="Claim" subtitle={PAGE_SUBTITLES.claim}>{unavailable}</PageShell>
    );
  }

  if (embedded) {
    return <ClaimView embedded noteId={noteId} />;
  }

  return (
    <PageShell
      title="Claim"
      subtitle={PAGE_SUBTITLES.claim}
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
