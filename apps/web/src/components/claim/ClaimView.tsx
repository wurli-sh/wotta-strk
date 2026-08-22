"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Inbox, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { NoteVisaCard } from "@/components/NoteVisaCard";
import { Button } from "@/components/ui/Button";
import { fireClaimConfetti } from "@/components/ui/confetti";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { getAccessToken } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { withMinSkeleton } from "@/lib/skeleton-hold";
import { createPrivacyClient } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { claimPrivateFund } from "@/lib/wotta/privacy-flow";
import { unlockPrivacyVault } from "@/lib/wotta/privacy-state";
import { createBrowserProductSession } from "@/lib/wotta/product-session";
import { connectReady } from "@/lib/wotta/ready";

type ClaimRow = {
  noteId: string;
  intentId: string;
  claimSecret: string;
  escrow: { address: string; classHash: string; denomination: bigint };
};

type ClaimPhase =
  | "idle"
  | "connecting"
  | "unlocking"
  | "loading"
  | "waiting_confirmations"
  | "building_proof"
  | "signing_message"
  | "generating_proof"
  | "submitting"
  | "confirming"
  | "complete";

const PHASE_LABELS: Record<ClaimPhase, string> = {
  idle: "Claim privately",
  connecting: "Connecting Ready…",
  unlocking: "Unlocking inbox…",
  loading: "Opening encrypted claim…",
  waiting_confirmations: "Waiting for a proof-safe block…",
  building_proof: "Building private claim…",
  signing_message: "Authorize in Ready…",
  generating_proof: "Generating privacy proof…",
  submitting: "Submitting proof…",
  confirming: "Confirming indexed claim…",
  complete: "Claimed",
};

type Props = {
  embedded?: boolean;
  /** When set (e.g. from Inbox), load this note instead of the latest claimable one. */
  noteId?: string | null;
  /** Attempt Ready unlock + decrypt on mount when signed in. */
  autoLoad?: boolean;
};

export function ClaimView({ embedded = false, noteId = null, autoLoad = true }: Props) {
  const [claim, setClaim] = useState<ClaimRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase>("idle");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setSignedIn(false);
        setClaim(null);
        setError("Sign in to decrypt inbox payments");
        return;
      }
      setSignedIn(true);
      await withMinSkeleton(async () => {
        const connected = await connectReady();
        const vault = await unlockPrivacyVault(connected.account, directPrivacyConfig());
        const latest = await createBrowserProductSession().loadClaim(
          vault,
          noteId ?? undefined,
        );
        setClaim(latest);
      });
    } catch (caught) {
      const message = userFacingError(caught, "No claimable private payment was found");
      setClaim(null);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (!autoLoad) return;
    void load();
  }, [autoLoad, load, noteId]);

  async function runClaim() {
    if (!claim) return;
    setBusy(true);
    setError(null);
    try {
      setPhase("connecting");
      const connected = await connectReady();
      setPhase("unlocking");
      const baseConfig = directPrivacyConfig();
      const vault = await unlockPrivacyVault(connected.account, baseConfig);
      if (!vault.state.identityAddress) {
        throw new Error("Register your private identity from Account before claiming");
      }
      const transfers = createPrivacyClient(
        vault.state.identityAddress,
        BigInt(vault.state.viewingKey),
        { ...baseConfig, escrow: claim.escrow },
      );
      const hash = await claimPrivateFund(
        connected.account,
        transfers,
        { ...baseConfig, escrow: claim.escrow },
        claim.claimSecret,
        (next) => setPhase(next),
      );
      setTransactionHash(hash);
      setPhase("confirming");
      const session = createBrowserProductSession();
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const intent = await session.intent(claim.intentId);
        if (intent.onchain_state === "claimed" || intent.state === "claimed") break;
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
      setPhase("complete");
      fireClaimConfetti();
      toast.success("Claimed into your private USDC balance");
    } catch (caught) {
      const message = userFacingError(caught, "Couldn’t claim this payment");
      setError(message);
      setPhase("idle");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <NoteCardSkeleton />;

  if (phase === "complete" && claim) {
    return (
      <div className="mx-auto max-w-lg">
        <NoteVisaCard
          label="Private balance"
          amount={(claim.escrow.denomination / 1_000_000n).toString()}
          recipient="You"
          status="Claimed"
          note="The proof settled this payment into a fresh private USDC note."
          footer={
            <div className="space-y-2">
              <Button className="w-full" href="/balance">
                <CheckCircle2 className="size-4" aria-hidden /> View private balance
              </Button>
              {transactionHash ? (
                <Button
                  variant="outline"
                  className="w-full"
                  href={`https://sepolia.voyager.online/tx/${transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" aria-hidden /> Explorer
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  const content = claim ? (
    <NoteVisaCard
      label="Ready to claim"
      amount={(claim.escrow.denomination / 1_000_000n).toString()}
      recipient="Private Starknet balance"
      status="Escrowed"
      note="Ready authorizes the claim; the hosted prover creates the private proof."
      footer={
        <Button className="w-full" disabled={busy} aria-busy={busy} onClick={() => void runClaim()}>
          {busy ? <TextShimmer>{PHASE_LABELS[phase]}</TextShimmer> : <><Sparkles className="size-4" aria-hidden /> Claim privately</>}
        </Button>
      }
    />
  ) : (
    <div className="radius-surface border border-dashed border-border bg-card px-6 py-10 text-center shadow-card">
      <Inbox className="mx-auto size-10 text-muted-foreground" aria-hidden />
      <h2 className="mt-4 text-base font-semibold text-foreground">No claimable payments</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        {error ?? (signedIn === false
          ? "Sign in from the navigation, then unlock with Ready."
          : "Unlock with Ready to decrypt your latest indexed payment.")}
      </p>
      <Button variant="outline" className="mt-5" onClick={() => void load()}>
        {signedIn === false ? "Retry after sign-in" : "Unlock inbox"}
      </Button>
    </div>
  );

  return embedded ? content : <div className="mx-auto max-w-lg">{content}</div>;
}
