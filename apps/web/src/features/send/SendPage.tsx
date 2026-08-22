"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Send } from "lucide-react";
import { toast } from "sonner";
import type { WottaSourceRoute } from "@wotta/adapters";
import type { Denomination } from "@wotta/shared";
import { ClaimView } from "@/components/claim/ClaimView";
import { DenomChips } from "@/components/DenomChips";
import { NoteVisaCard } from "@/components/NoteVisaCard";
import { PageShell } from "@/components/PageShell";
import { TabContentShimmer } from "@/components/PageShimmer";
import {
  SourceChips,
  buildSourceRoutes,
  type RouteRow,
  type SourceRail,
} from "@/components/SourceChips";
import { SignInModal } from "@/components/SignInModal";
import { useSourceWallet } from "@/components/SourceWalletProvider";
import { Button } from "@/components/ui/Button";
import { MotionPillButton } from "@/components/ui/MotionLink";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import {
  NoteCardSkeleton,
  SendFormSkeleton,
  SendPageSkeleton,
} from "@/components/ui/Skeleton";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { apiFetch } from "@/lib/api/client";
import { AUTH_SESSION_EVENT, getAccessToken } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type Dens } from "@/lib/denoms";
import { userFacingError } from "@/lib/errors";
import { QuoteCard } from "@/features/send/QuoteCard";
import { SendProgress } from "@/features/send/SendProgress";
import { createPrivacyClient, isIdentityRegistered } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { privateTransfer } from "@/lib/wotta/privacy-flow";
import type { ProofPhase } from "@/lib/wotta/privacy-proof";
import { unlockPrivacyVault } from "@/lib/wotta/privacy-state";
import {
  createBrowserProductSession,
  type FundingStage,
  type RouteManifest,
} from "@/lib/wotta/product-session";
import { connectReady } from "@/lib/wotta/ready";

type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "registered" }
  | { status: "pending" }
  | { status: "invalid" | "error" };

type SendStage = "idle" | FundingStage | ProofPhase | "unlocking_private" | "complete";
type DeliveryMode = "inbox" | "pending" | "direct";

const PENDING_TTL_DAYS = 7;
const CROSS_CHAIN_ROUTES = new Set<WottaSourceRoute>([
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
]);

function parseRecipient(raw: string): { provider: "email" | "x"; identifier: string } | null {
  const value = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { provider: "email", identifier: value.toLowerCase() };
  }
  const handle = value.startsWith("@") ? value : `@${value}`;
  return /^@[a-zA-Z0-9_]{1,32}$/.test(handle)
    ? { provider: "x", identifier: handle.toLowerCase() }
    : null;
}

function denominationBaseUnits(value: Dens): Denomination {
  return (value * 1_000_000n).toString() as Denomination;
}

function stageLabel(stage: SendStage, denom: Dens): string {
  const labels: Record<SendStage, string> = {
    idle: `Send ${denom} USDC`,
    resolving: "Resolving recipient…",
    quoting: "Verifying quote…",
    delivering: "Encrypting delivery…",
    connecting_source: "Connecting source wallet…",
    approving: "Approve USDC in wallet…",
    burning: "Confirm CCTP burn…",
    confirming: "Confirming source transaction…",
    settling: "Settling privately on Starknet…",
    unlocking_private: "Unlocking private balance…",
    waiting_confirmations: "Waiting for a proof-safe block…",
    building_proof: "Building private transfer…",
    signing_message: "Authorize in Ready…",
    generating_proof: "Generating privacy proof…",
    submitting: "Submitting proof…",
    complete: "Escrowed",
  };
  return labels[stage];
}

function lookupTone(status: Lookup["status"]): string {
  if (status === "registered") return "border-success/25 bg-success/10 text-success";
  if (status === "pending") return "border-warning-border bg-warning-surface text-warning";
  if (status === "invalid" || status === "error") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (status === "checking") return "border-brand-muted bg-brand-soft text-brand-ink";
  return "border-border bg-muted text-muted-foreground";
}

function LookupStatus({ lookup, onRetry }: { lookup: Lookup; onRetry: () => void }) {
  const rows: Record<Lookup["status"], { label: string; detail: string }> = {
    idle: { label: "Required", detail: "Enter an @handle or email" },
    checking: { label: "Checking", detail: "Looking up this recipient…" },
    registered: { label: "On Wotta", detail: "Claim goes to their encrypted inbox" },
    pending: { label: "Not joined", detail: `Claim held for ${PENDING_TTL_DAYS} days` },
    invalid: { label: "Invalid", detail: "Use a valid @handle or email" },
    error: { label: "Unavailable", detail: "Couldn’t check this recipient" },
  };
  const row = rows[lookup.status];
  return (
    <div
      id="send-recipient-status"
      className="flex min-h-6 flex-wrap items-center gap-2 px-1 pt-0.5"
      role={lookup.status === "invalid" || lookup.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold", lookupTone(lookup.status))}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        {row.label}
      </span>
      <span className="text-xs leading-5 text-muted-foreground">{row.detail}</span>
      {lookup.status === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-10 rounded-full px-3 text-xs font-semibold text-brand-ink outline-none transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

function SendForm() {
  const { setSource: rememberSource } = useSourceWallet();
  const [denom, setDenom] = useState<Dens>(1n);
  const [recipient, setRecipient] = useState("");
  const [source, setSource] = useState<SourceRail>("base");
  const [routes, setRoutes] = useState<RouteRow[]>(() => buildSourceRoutes());
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [lookupRetry, setLookupRetry] = useState(0);
  const [stage, setStage] = useState<SendStage>("idle");
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryMode | null>(null);
  const [successRecipient, setSuccessRecipient] = useState("");
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [successRoute, setSuccessRoute] = useState<SourceRail | null>(null);
  const [recovery, setRecovery] = useState<{
    claimSecret: string;
    escrow: string;
    expiresAt: string;
  } | null>(null);
  const lookupRequest = useRef(0);

  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to) setRecipient(to);
    void apiFetch<RouteManifest>("/v1/routes", { suppressServiceStatus: true })
      .then((manifest) => {
        const next = buildSourceRoutes(manifest.routes).map((route) =>
          route.key === "starknet-public"
            ? { ...route, selectable: false, status: "soon" as const, reason: "Public Starknet deposit UI is not wired yet" }
            : route,
        );
        setRoutes(next);
        const first = next.find((route) => route.selectable);
        if (first) setSource(first.key);
      })
      .catch(() => setRoutes(buildSourceRoutes()));
  }, []);

  useEffect(() => {
    const request = ++lookupRequest.current;
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      setLookup(recipient.trim() ? { status: "invalid" } : { status: "idle" });
      return;
    }
    setLookup({ status: "checking" });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const token = await getAccessToken();
          if (!token) {
            if (controller.signal.aborted || request !== lookupRequest.current) return;
            setLookup({ status: "idle" });
            return;
          }
          const result = await createBrowserProductSession().resolveRecipient(parsed);
          if (controller.signal.aborted || request !== lookupRequest.current) return;
          setLookup({ status: result.descriptor.registered ? "registered" : "pending" });
        } catch (error) {
          if (controller.signal.aborted || request !== lookupRequest.current) return;
          if (error instanceof Error && /sign in/i.test(error.message)) {
            setLookup({ status: "idle" });
          } else {
            setLookup({ status: "error" });
          }
        }
      })();
    }, 450);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [recipient, lookupRetry]);

  useEffect(() => {
    function onSession() {
      setLookupRetry((value) => value + 1);
    }
    window.addEventListener(AUTH_SESSION_EVENT, onSession);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, onSession);
  }, []);

  async function run() {
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      toast.error("Enter a valid @handle or email");
      return;
    }
    setBusy(true);
    setDelivery(null);
    setRecovery(null);
    try {
      const session = createBrowserProductSession();
      await session.syncSession();
      const me = await session.me();
      if (!me.wallet?.address) throw new Error("Link your Ready wallet from Account first");
      if (source === "starknet-private") {
        setStage("connecting_source");
        const connected = await connectReady();
        if (BigInt(connected.address) !== BigInt(me.wallet.address)) {
          throw new Error("Connect the Ready account linked to this Wotta profile");
        }
        const config = directPrivacyConfig();
        setStage("unlocking_private");
        const vault = await unlockPrivacyVault(connected.account, config);
        if (!vault.state.identityAddress) {
          throw new Error("Register your private identity from Account first");
        }
        const transfers = createPrivacyClient(
          vault.state.identityAddress,
          BigInt(vault.state.viewingKey),
          config,
        );
        setStage("resolving");
        const recipientIdentity = await session.resolvePrivateRecipient(
          parsed.identifier,
          config.poolAddress,
        );
        if (!await isIdentityRegistered(connected.account, config, recipientIdentity)) {
          throw new Error("Recipient private identity is not registered");
        }
        const transactionHash = await privateTransfer(
          connected.account,
          transfers,
          config.usdc,
          recipientIdentity,
          BigInt(denominationBaseUnits(denom)),
          (next) => setStage(next),
        );
        setDelivery("direct");
        setSuccessRecipient(parsed.identifier);
        setSuccessTx(transactionHash);
        setSuccessRoute(source);
        rememberSource({
          routeKey: source,
          family: "starknet",
          address: connected.address,
          label: "Private Starknet",
        });
        setStage("complete");
        toast.success("Private transfer confirmed");
        return;
      }
      if (!CROSS_CHAIN_ROUTES.has(source as WottaSourceRoute)) {
        throw new Error("This Starknet source is not available yet");
      }
      const result = await session.fundFromCircleSource({
        route: source as WottaSourceRoute,
        denomination: denominationBaseUnits(denom),
        recipient: parsed.identifier,
        publicRefundRecipient: me.wallet.address,
        onStage: setStage,
        onRecovery: setRecovery,
      });
      setDelivery(lookup.status === "registered" ? "inbox" : "pending");
      setSuccessRecipient(parsed.identifier);
      setSuccessTx(result.sourceTxHash);
      setSuccessRoute(source);
      rememberSource({
        routeKey: source,
        family: ["solana", "stellar"].includes(source) ? source as "solana" | "stellar" : "evm",
        address: result.sourceAccount,
        label: routes.find((route) => route.key === source)?.label,
      });
      setStage("complete");
      toast.success("Escrowed on Starknet");
    } catch (error) {
      const message = userFacingError(error, "Couldn’t send");
      if (/sign in/i.test(message)) setAuthOpen(true);
      toast.error(message);
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  if (stage === "complete" && delivery) {
    const heldUntil = new Date(Date.now() + PENDING_TTL_DAYS * 86_400_000);
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <NoteVisaCard
          label={delivery === "direct" ? "Private transfer" : delivery === "inbox" ? "In their inbox" : "Waiting for join"}
          amount={String(denom)}
          recipient={successRecipient}
          status={delivery === "direct" ? "Received privately" : delivery === "inbox" ? "Claimable" : "On hold"}
          note={delivery === "pending" ? `Held until ${heldUntil.toLocaleDateString()}` : delivery === "direct" ? "Private balance → private balance" : "Claim → private Starknet balance"}
          footer={
            <div className="space-y-2">
              <MotionPillButton className="w-full" onClick={() => { setStage("idle"); setDelivery(null); setSuccessTx(null); setSuccessRoute(null); setRecovery(null); }}>
                Send another
              </MotionPillButton>
              {recovery ? (
                <p className="rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-left text-xs text-warning">
                  Recovery claim secret saved locally for this session. Share only with the intended recipient if inbox delivery fails.
                  <span className="mt-2 block break-all font-mono text-[11px] text-foreground">{recovery.claimSecret}</span>
                </p>
              ) : null}
              {successTx ? (
                <Button
                  variant="outline"
                  className="w-full"
                  href={successRoute === "starknet-private" ? `https://sepolia.voyager.online/tx/${successTx}` : `https://testnet.circle.com/en/transactions/${successTx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" /> {successRoute === "starknet-private" ? "Private transfer transaction" : "Source transaction"}
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="radius-surface overflow-hidden border border-border/80 bg-card p-2 shadow-card">
        <div className="radius-surface-inner border border-brand/15 bg-brand-mist px-6 py-6 sm:px-8 sm:py-7">
          <DenomChips value={denom} onChange={setDenom} disabled={busy} />
        </div>
        <div className="space-y-5 px-3 pb-3 pt-5 sm:px-4 sm:pb-4">
          <SourceChips routes={routes} value={source} onChange={setSource} disabled={busy} />
          <div className="space-y-3">
            <label htmlFor="send-recipient" className="block text-sm font-semibold text-foreground">Recipient</label>
            <input
              id="send-recipient"
              data-testid="handle-input"
              type="text"
              className="radius-control w-full border border-border/70 bg-muted px-5 py-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-100 ease-out placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              disabled={busy}
              placeholder="@handle or you@example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={lookup.status === "invalid" || lookup.status === "error" ? true : undefined}
              aria-describedby="send-recipient-status"
            />
            <LookupStatus lookup={lookup} onRetry={() => setLookupRetry((value) => value + 1)} />
          </div>
          <QuoteCard
            grossDebit={denom * 1_000_000n}
            privacyNote="The source burn and escrow amount are public. Recipient ownership and the claimed balance remain private."
          />
          <SendProgress stage={stage} />
          {recovery && busy ? (
            <p className="rounded-xl border border-brand-muted bg-brand-mist px-4 py-3 text-left text-xs text-muted-foreground">
              Claim package encrypted. Approve the source wallet when prompted.
              <span className="mt-2 block break-all font-mono text-[11px] text-foreground">{recovery.claimSecret}</span>
            </p>
          ) : null}
          <MotionPillButton
            data-testid="send-submit"
            className="w-full min-h-12 text-base"
            disabled={busy || !["registered", "pending"].includes(lookup.status) || !routes.some((route) => route.key === source && route.selectable)}
            aria-busy={busy}
            onClick={() => void run()}
          >
            {busy ? <TextShimmer className="text-base font-semibold">{stageLabel(stage, denom)}</TextShimmer> : <><Send className="size-4" />{stageLabel("idle", denom)}</>}
          </MotionPillButton>
        </div>
      </div>
      <SignInModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}

function SendPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "claim" ? "claim" : "send";
  const noteId = params.get("noteId");
  function changeTab(next: "send" | "claim") {
    const query = new URLSearchParams(params.toString());
    if (next === "claim") query.set("tab", "claim");
    else {
      query.delete("tab");
      query.delete("noteId");
    }
    const value = query.toString();
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false });
  }
  return (
    <PageShell
      title={tab === "claim" ? "Claim" : "Send"}
      subtitle={tab === "claim" ? "Claim USDC from your inbox into your private Starknet balance." : "Pay an email or @handle from any admitted testnet source."}
    >
      <div className="mb-6 flex justify-center">
        <SegmentedTabs
          layoutId="send-claim"
          ariaLabel="Send or claim"
          value={tab}
          onValueChange={changeTab}
          items={[{ value: "send", label: "Send" }, { value: "claim", label: "Claim" }]}
        />
      </div>
      <TabContentShimmer holdKey={tab} skeleton={tab === "claim" ? <NoteCardSkeleton /> : <SendFormSkeleton />}>
        {tab === "claim" ? <ClaimView embedded noteId={noteId} /> : <SendForm />}
      </TabContentShimmer>
    </PageShell>
  );
}

export function SendPage() {
  return <Suspense fallback={<SendPageSkeleton />}><SendPageInner /></Suspense>;
}
