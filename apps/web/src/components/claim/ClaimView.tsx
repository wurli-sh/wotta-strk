"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Inbox, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { NoteVisaCard } from "@/components/NoteVisaCard";
import { usePrivacyVault } from "@/components/PrivacyVaultProvider";
import { Button } from "@/components/ui/Button";
import { Confetti, type ConfettiRef } from "@/components/ui/confetti";
import { NoteCardSkeleton } from "@/components/ui/Skeleton";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { fireClaimConfetti } from "@/features/claim/celebrateClaim";
import { getAccessToken } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { withMinSkeleton } from "@/lib/skeleton-hold";
import { createPrivacyClient } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { claimPrivateFund } from "@/lib/wotta/privacy-flow";
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
};

export function ClaimView({ embedded = false, noteId = null }: Props) {
  const { vault } = usePrivacyVault();
  const confettiRef = useRef<ConfettiRef>(null);
  const [claim, setClaim] = useState<ClaimRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase>("idle");
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const loadFromVault = useCallback(async () => {
    if (!vault) return;
    setLoading(true);
    setError(null);
    try {
      await withMinSkeleton(async () => {
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
  }, [noteId, vault]);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (!token) {
        setSignedIn(false);
        setError("Sign in to claim inbox payments");
        return;
      }
      setSignedIn(true);
    })();
  }, []);

  useEffect(() => {
    if (!vault) {
      setClaim(null);
      return;
    }
    void loadFromVault();
  }, [vault, loadFromVault]);

  async function runClaim() {
    if (!claim || !vault) {
      toast.error("Unlock your inbox from Inbox first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setPhase("connecting");
      const connected = await connectReady();
      const baseConfig = directPrivacyConfig();
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
      toast.success("Claim submitted");
      // Same as Swoop: celebrate immediately on successful submit.
      fireClaimConfetti(confettiRef.current);

      const session = createBrowserProductSession();
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const intent = await session.intent(claim.intentId);
        if (intent.onchain_state === "claimed" || intent.state === "claimed") break;
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
      setPhase("complete");
    } catch (caught) {
      const message = userFacingError(caught, "Couldn't claim this payment");
      setError(message);
      setPhase("idle");
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  let body: ReactNode;

  if (loading) {
    body = <NoteCardSkeleton />;
  } else if (phase === "complete" && claim) {
    body = (
      <NoteVisaCard
        label="Private balance"
        amount={(claim.escrow.denomination / 1_000_000n).toString()}
        recipient="You"
        status="Claimed"
        note="The proof settled this payment into a fresh private USDC note."
        footer={
          <div className="space-y-2">
            <Button className="w-full" href="/account?tab=wallet">
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
    );
  } else if (claim) {
    body = (
      <NoteVisaCard
        label="Ready to claim"
        amount={(claim.escrow.denomination / 1_000_000n).toString()}
        recipient="Private Starknet balance"
        status="Escrowed"
        footer={
          <Button
            variant="brand"
            size="lg"
            className="w-full radius-surface-inner"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void runClaim()}
          >
            {busy ? <TextShimmer>{PHASE_LABELS[phase]}</TextShimmer> : <><Sparkles className="size-4" aria-hidden /> Claim privately</>}
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="radius-surface flex flex-col items-center gap-4 border border-dashed border-border bg-card px-6 py-10 text-center shadow-card">
        <Inbox className="size-10 text-muted-foreground" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">No claimable payments</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {error ?? (signedIn === false
              ? "Sign in from the navigation, then unlock your inbox."
              : !vault
                ? "Unlock your inbox to decrypt claimable payments."
                : "Nothing claimable right now — check Incoming on Inbox.")}
          </p>
        </div>
        <Button
          variant="outline"
          className="min-w-[10rem]"
          href={signedIn === false ? "/account" : "/inbox"}
        >
          {signedIn === false ? "Go to Account" : "Open inbox"}
        </Button>
      </div>
    );
  }

  return (
    <div className={embedded ? "relative mx-auto w-full" : "relative mx-auto w-full max-w-lg"}>
      <Confetti
        ref={confettiRef}
        manualstart
      />
      {body}
    </div>
  );
}
