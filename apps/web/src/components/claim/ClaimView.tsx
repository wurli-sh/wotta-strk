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
import { createPrivacyClient } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { claimPrivateFund } from "@/lib/wotta/privacy-flow";
import { createBrowserProductSession } from "@/lib/wotta/product-session";
import { ensureClaimInboxKey } from "@/lib/wotta/ensure-inbox-key";
import { connectReady } from "@/lib/wotta/ready";
import { beginNetworkOperation } from "@/lib/network-operations";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { starkscanTransactionUrl } from "@/lib/network-mode";
import { submitMainnetEscrowClaim } from "@/lib/wotta/mainnet-privacy";
import { TOAST } from "@/lib/brand-copy";
import { formatUsdc } from "@/lib/format/amount";
import { isMissingInboxKeyError, isWrongInboxKeyError } from "@/lib/wotta/inbox-note-access";

type ClaimRow = {
  noteId: string;
  intentId: string;
  claimSecret: string;
  escrow: { address: string; classHash: string; denomination: bigint };
};

type ClaimSuccess = {
  denomination: bigint;
  transactionHash: string;
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
  generating_proof: "Generating private proof…",
  submitting: "Submitting proof…",
  confirming: "Confirming indexed claim…",
  complete: "Claimed",
};

type Props = {
  embedded?: boolean;
  /** When set (e.g. from Inbox), load this note instead of the latest claimable one. */
  noteId?: string | null;
};

function isMissingInboxKey(error: string | null, vault: { state: { inboxSecretKey?: string } } | null): boolean {
  if (vault && !vault.state.inboxSecretKey) return true;
  return isMissingInboxKeyError(error);
}

export function ClaimView({ embedded = false, noteId = null }: Props) {
  const { mode } = useNetworkMode();
  const { vault, unlocking, unlock, sessionReady } = usePrivacyVault();
  const confettiRef = useRef<ConfettiRef>(null);
  const [claim, setClaim] = useState<ClaimRow | null>(null);
  const [success, setSuccess] = useState<ClaimSuccess | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const loadFromVault = useCallback(async () => {
    if (!vault?.state.inboxSecretKey) {
      setClaim(null);
      if (vault && !vault.state.inboxSecretKey) {
        setError("This browser has no Wotta inbox key");
      }
      return;
    }
    const operation = beginNetworkOperation(mode);
    setLoading(true);
    setError(null);
    try {
      const latest = await createBrowserProductSession().loadClaim(
        vault,
        noteId ?? undefined,
      );
      operation.assertActive();
      setClaim(latest);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = userFacingError(caught, "No claimable private payment was found");
      setClaim(null);
      setError(message);
    } finally {
      operation.finish();
      setLoading(false);
    }
  }, [mode, noteId, vault]);

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
    if (!sessionReady) return;
    if (!vault) {
      setClaim(null);
      setError(null);
      return;
    }
    void loadFromVault();
  }, [vault, loadFromVault, sessionReady]);

  async function unlockInbox() {
    setLoading(true);
    setError(null);
    try {
      const { vault: next, account } = await unlock();
      const { rebound } = await ensureClaimInboxKey(next, account, mode);
      try {
        const latest = await createBrowserProductSession().loadClaim(
          next,
          noteId ?? undefined,
        );
        setClaim(latest);
        setError(null);
        if (rebound) {
          toast.message("Ready re-linked on this device. New payments will claim here.");
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        const message = rebound
          ? "Inbox key was reset on this device — older encrypted payments can’t be opened. Ask for a new send."
          : userFacingError(caught, "No claimable private payment was found");
        setClaim(null);
        setError(message);
        toast.error(message);
      }
    } catch (caught) {
      toast.error(userFacingError(caught, TOAST.inboxUnlockFailed));
      setError(userFacingError(caught, TOAST.inboxUnlockFailed));
    } finally {
      setLoading(false);
    }
  }

  async function runClaim() {
    if (!claim || !vault?.state.inboxSecretKey) {
      toast.error(TOAST.unlockInboxFirst);
      return;
    }
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    setBusy(true);
    setError(null);
    try {
      setPhase("connecting");
      const connected = await connectReady(mode);
      const hash = mode === "mainnet"
        ? await submitMainnetEscrowClaim(connected.account, claim, operation.signal)
        : await (async () => {
            const baseConfig = directPrivacyConfig();
            if (!vault.state.identityAddress) {
              throw new Error("Register your private identity from Account before claiming");
            }
            const transfers = createPrivacyClient(
              vault.state.identityAddress,
              BigInt(vault.state.viewingKey),
              { ...baseConfig, escrow: claim.escrow },
            );
            return claimPrivateFund(
              connected.account,
              transfers,
              { ...baseConfig, escrow: claim.escrow },
              claim.claimSecret,
              (next) => setPhase(next),
            );
          })();
      operation.assertActive();
      setSuccess({ denomination: claim.escrow.denomination, transactionHash: hash });
      setPhase("complete");
      toast.success(TOAST.claimed);
      fireClaimConfetti(confettiRef.current);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("wotta:private-balance-invalidate"));
      }
    } catch (caught) {
      const message = userFacingError(caught, "Couldn't claim this payment");
      setError(message);
      setPhase("idle");
      toast.error(message);
    } finally {
      operation.finish();
      setBusy(false);
    }
  }

  const wrongKey = isWrongInboxKeyError(error);
  const needsUnlock = signedIn === true && !wrongKey && (!vault || isMissingInboxKey(error, vault));
  const missingKey = isMissingInboxKey(error, vault);

  let body: ReactNode;

  if (signedIn === null || !sessionReady || loading) {
    body = <NoteCardSkeleton />;
  } else if (phase === "complete" && success) {
    body = (
      <NoteVisaCard
        label="Private balance"
        amount={formatUsdc(success.denomination)}
        recipient="You"
        status="Claimed"
        note="The proof settled this payment into a fresh private USDC note."
        footer={
          <div className="space-y-2">
            <Button className="w-full" href="/account?tab=wallet">
              <CheckCircle2 className="size-4" aria-hidden /> View private balance
            </Button>
            <Button
              variant="outline"
              className="w-full"
              href={starkscanTransactionUrl(mode, success.transactionHash)}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="size-4" aria-hidden /> Explorer
            </Button>
          </div>
        }
      />
    );
  } else if (claim) {
    body = (
      <NoteVisaCard
        label="Ready to claim"
        amount={formatUsdc(claim.escrow.denomination)}
        recipient="Private Starknet balance"
        status="Settled privately"
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
    const title = signedIn === false
      ? "Sign in to claim"
      : wrongKey
        ? "Can’t open this payment"
        : needsUnlock
          ? "Unlock to claim"
          : "No claimable payments";
    const detail = error ?? (signedIn === false
      ? "Sign in from Account, then unlock your Ready inbox."
      : !vault
        ? "Authorize Ready once to decrypt this payment on this device."
        : missingKey
          ? "This device is missing the inbox key that can open this payment. Unlock with the same Ready account that linked your Wotta profile — or re-link from Account."
          : "Nothing claimable right now — check Incoming on Inbox.");

    body = (
      <div className="radius-surface flex flex-col items-center gap-4 border border-dashed border-border bg-card px-6 py-10 text-center shadow-card">
        <Inbox className="size-10 text-muted-foreground" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{detail}</p>
        </div>
        {signedIn === false ? (
          <Button variant="outline" className="min-w-[10rem]" href="/account">
            Go to Account
          </Button>
        ) : wrongKey ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="brand" className="min-w-[10rem]" href="/send">
              Send a new payment
            </Button>
            <Button variant="outline" className="min-w-[10rem]" href="/inbox">
              Back to Inbox
            </Button>
          </div>
        ) : needsUnlock && !missingKey ? (
          <Button
            variant="brand"
            className="min-w-[10rem]"
            disabled={unlocking}
            aria-busy={unlocking}
            onClick={() => void unlockInbox()}
          >
            {unlocking ? "Unlocking…" : "Unlock inbox"}
          </Button>
        ) : missingKey ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="brand"
              className="min-w-[10rem]"
              disabled={unlocking}
              aria-busy={unlocking}
              onClick={() => void unlockInbox()}
            >
              {unlocking ? "Unlocking…" : "Unlock Ready"}
            </Button>
            <Button variant="outline" className="min-w-[10rem]" href="/account?tab=wallet">
              Account
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="min-w-[10rem]" href="/inbox">
            Open inbox
          </Button>
        )}
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
