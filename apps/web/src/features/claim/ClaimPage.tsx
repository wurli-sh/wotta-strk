"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ClaimView } from "@/components/claim/ClaimView";
import { PageShell } from "@/components/PageShell";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";

function ClaimPageInner({ embedded = false }: { embedded?: boolean }) {
  const params = useSearchParams();
  const noteId = params.get("noteId");

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
