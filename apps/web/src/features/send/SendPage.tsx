"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExternalLink, Send, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  connectEvmSource,
  connectSolanaSource,
  connectStellarSource,
  type WottaSourceRoute,
} from "@wotta/adapters";
import type { Denomination } from "@wotta/shared";
import { ClaimView } from "@/components/claim/ClaimView";
import { DenomChips } from "@/components/DenomChips";
import { NoteVisaCard } from "@/components/NoteVisaCard";
import { PageShell } from "@/components/PageShell";
import { TabContentShimmer } from "@/components/PageShimmer";
import {
  SourceChips,
  isStarknetSource,
  type RouteRow,
  type SourceRail,
} from "@/components/SourceChips";
import { SignInModal } from "@/components/SignInModal";
import {
  familyForRoute,
  useSourceWallet,
} from "@/components/SourceWalletProvider";
import { Button } from "@/components/ui/Button";
import { MotionPillButton } from "@/components/ui/MotionLink";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import {
  NoteCardSkeleton,
  SendFormSkeleton,
  SendPageSkeleton,
} from "@/components/ui/Skeleton";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { ConfidentialToggle } from "@/features/send/ConfidentialToggle";
import { NOX_ROUTE_ID, PUBLIC_DEFAULT_ROUTE_ID } from "@/features/send/routeIds";
import {
  sourceTxExplorerLabel,
  sourceTxExplorerUrl,
} from "@/features/send/sourceExplorer";
import { useRoutesHealth } from "@/features/send/useRoutesHealth";
import { apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type Dens } from "@/lib/denoms";
import { userFacingError } from "@/lib/errors";
import { requireSourceWallet } from "@/lib/wallet-install";
import { createPrivacyClient, isIdentityRegistered } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { privateTransfer } from "@/lib/wotta/privacy-flow";
import type { ProofPhase } from "@/lib/wotta/privacy-proof";
import { unlockPrivacyVault } from "@/lib/wotta/privacy-state";
import {
  createBrowserProductSession,
  type FundingStage,
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
    approving: "Approve USDC…",
    depositing: "Deposit to Wotta escrow…",
    burning: "Confirm CCTP burn…",
    confirming: "Confirming source transaction…",
    attesting: "Waiting for Circle attestation…",
    settling: "Settling privately on Starknet…",
    unlocking_private: "Unlocking private balance…",
    waiting_confirmations: "Waiting for a proof-safe block…",
    building_proof: "Building private transfer…",
    signing_message: "Authorize in wallet…",
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

function preferredPublicRoute(routes: RouteRow[]): SourceRail | null {
  return routes.find((route) => route.key === "starknet-public" && route.selectable)?.key
    ?? routes.find((route) => route.key !== NOX_ROUTE_ID && route.selectable)?.key
    ?? null;
}

function SendForm() {
  const {
    setSource: rememberSource,
    getSource,
    matchesRoute,
  } = useSourceWallet();
  const { routes, routesHealth, routesReady, retryRoutesHealth } = useRoutesHealth();
  const [denom, setDenom] = useState<Dens>(1n);
  const [recipient, setRecipient] = useState("");
  const [confidentialMode, setConfidentialMode] = useState(false);
  const [source, setSource] = useState<SourceRail>(PUBLIC_DEFAULT_ROUTE_ID);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const [lookupRetry, setLookupRetry] = useState(0);
  const [stage, setStage] = useState<SendStage>("idle");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryMode | null>(null);
  const [successRecipient, setSuccessRecipient] = useState("");
  const [successTx, setSuccessTx] = useState<string | null>(null);
  const [successRoute, setSuccessRoute] = useState<SourceRail | null>(null);
  const lookupRequest = useRef(0);

  const walletConnected = matchesRoute(source);
  const CONNECT_CHAIN_LABEL: Record<SourceRail, string> = {
    ethereum: "Ethereum",
    arbitrum: "Arbitrum",
    base: "Base",
    solana: "Solana",
    stellar: "Stellar",
    "starknet-public": "Starknet",
    "starknet-private": "Ready",
  };
  const sourceLabel = routes.find((route) => route.key === source)?.label
    ?? CONNECT_CHAIN_LABEL[source];
  // Swoop: `Connect ${routeLabel(routeId)} wallet` — always include "wallet".
  const connectLabel = isStarknetSource(source) || confidentialMode
    ? "Connect Ready wallet"
    : `Connect ${sourceLabel} wallet`;

  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to) setRecipient(to);
  }, []);

  useEffect(() => {
    if (!routesReady) return;
    if (confidentialMode) {
      setSource(NOX_ROUTE_ID);
      return;
    }
    setSource((current) => {
      if (!isStarknetSource(current)) return current;
      return "starknet-public";
    });
  }, [routes, routesReady, confidentialMode]);

  useEffect(() => {
    if (!routesReady || confidentialMode) return;
    setSource((current) => {
      const selected = routes.find((route) => route.key === current);
      if (selected?.selectable) return current;
      return preferredPublicRoute(routes) ?? current;
    });
  }, [routes, routesReady, confidentialMode]);

  function onConfidentialModeChange(enabled: boolean) {
    setConfidentialMode(enabled);
    if (enabled) {
      // Same Ready wallet serves public + private; retag so matchesRoute passes.
      const starknet = getSource("starknet-public") ?? getSource(NOX_ROUTE_ID);
      if (starknet) {
        rememberSource({
          ...starknet,
          routeKey: NOX_ROUTE_ID,
          label: "Private Starknet",
        });
      }
      setSource(NOX_ROUTE_ID);
      return;
    }
    const starknet = getSource(NOX_ROUTE_ID) ?? getSource("starknet-public");
    if (starknet) {
      rememberSource({
        ...starknet,
        routeKey: "starknet-public",
        label: "Starknet",
      });
    }
    if (isStarknetSource(source)) {
      setSource("starknet-public");
      return;
    }
    const next = preferredPublicRoute(routes);
    if (next) setSource(next);
  }

  const privateReady =
    !confidentialMode
    || routes.some((route) => route.key === NOX_ROUTE_ID && route.selectable);
  const sourceReady = routes.some((route) => route.key === source && route.selectable);
  const recipientReady = lookup.status === "registered" || lookup.status === "pending";
  const formLocked = busy || stage === "complete";

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
          const result = await apiFetch<{ descriptor: { registered: boolean } }>("/v1/resolve", {
            token,
            method: "POST",
            body: parsed,
          });
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

  async function connectSourceWallet() {
    if (connecting || busy) return;
    setConnecting(true);
    try {
      if (isStarknetSource(source)) {
        const connected = await connectReady();
        rememberSource({
          routeKey: source,
          family: "starknet",
          address: connected.address,
          label: confidentialMode ? "Private Starknet" : "Starknet",
        });
        toast.success("Ready wallet connected");
        return;
      }
      if (!CROSS_CHAIN_ROUTES.has(source as WottaSourceRoute)) {
        throw new Error("This source is not available yet");
      }
      const route = source as WottaSourceRoute;
      await requireSourceWallet(route);
      const address = route === "solana"
        ? await connectSolanaSource()
        : route === "stellar"
          ? await connectStellarSource()
          : await connectEvmSource(route);
      rememberSource({
        routeKey: source,
        family: familyForRoute(source),
        address,
        label: sourceLabel,
      });
      toast.success(`${sourceLabel} wallet connected`);
    } catch (error) {
      toast.error(userFacingError(error, "Wallet connect failed"));
    } finally {
      setConnecting(false);
    }
  }

  async function run() {
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      toast.error("Enter a valid @handle or email");
      return;
    }
    setBusy(true);
    setDelivery(null);
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
      if (source === "starknet-public") {
        const result = await session.fundFromStarknetPublic({
          denomination: denominationBaseUnits(denom),
          recipient: parsed.identifier,
          publicRefundRecipient: me.wallet.address,
          linkedReadyAddress: me.wallet.address,
          onStage: setStage,
        });
        setDelivery(lookup.status === "registered" ? "inbox" : "pending");
        setSuccessRecipient(parsed.identifier);
        setSuccessTx(result.sourceTxHash);
        setSuccessRoute(source);
        rememberSource({
          routeKey: source,
          family: "starknet",
          address: result.sourceAccount,
          label: routes.find((route) => route.key === source)?.label,
        });
        setStage("complete");
        toast.success("Escrowed on Starknet");
        return;
      }
      if (!CROSS_CHAIN_ROUTES.has(source as WottaSourceRoute)) {
        throw new Error("This source is not available yet");
      }
      const result = await session.fundFromCircleSource({
        route: source as WottaSourceRoute,
        denomination: denominationBaseUnits(denom),
        recipient: parsed.identifier,
        publicRefundRecipient: me.wallet.address,
        onStage: setStage,
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
      if (/settlement is still finishing|continues in the background|still pending/i.test(message)) {
        toast.message(message);
      } else {
        toast.error(message);
      }
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
              <MotionPillButton className="w-full" onClick={() => { setStage("idle"); setDelivery(null); setSuccessTx(null); setSuccessRoute(null); }}>
                Send another
              </MotionPillButton>
              {successTx ? (
                <Button
                  variant="outline"
                  className="w-full"
                  href={sourceTxExplorerUrl(successRoute, successTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-4" /> {sourceTxExplorerLabel(successRoute)}
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
          <DenomChips value={denom} onChange={setDenom} disabled={formLocked} />
        </div>
        <div className="space-y-5 px-3 pb-3 pt-5 sm:px-4 sm:pb-4">
          <ConfidentialToggle
            enabled={confidentialMode}
            disabled={formLocked || !routesReady}
            onChange={onConfidentialModeChange}
          />

          {routesReady ? (
            <SourceChips
              routes={routes}
              value={source}
              onChange={setSource}
              disabled={formLocked}
              privateMode={confidentialMode}
            />
          ) : (
            <div
              className="radius-surface-inner space-y-2 border border-warning-border bg-warning-surface px-4 py-3 text-xs text-warning-foreground"
              role="status"
            >
              <p>
                {routesHealth === "loading"
                  ? "Checking route health — hold on a sec."
                  : "API is waking up — chain selection unlocks once route health is back."}
              </p>
              {routesHealth === "waking" ? (
                <button
                  type="button"
                  onClick={retryRoutesHealth}
                  className="text-xs font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}

          {confidentialMode && routesReady && !privateReady ? (
            <div
              className="radius-surface-inner border border-warning-border bg-warning-surface px-4 py-3 text-xs text-warning-foreground"
              role="status"
            >
              Private route is unavailable — register your private identity from Account first.
            </div>
          ) : null}

          <div className="space-y-3">
            <label htmlFor="send-recipient" className="block text-sm font-semibold text-foreground">Recipient</label>
            <input
              id="send-recipient"
              data-testid="handle-input"
              type="text"
              className="radius-control w-full border border-border/70 bg-muted px-5 py-3.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-100 ease-out placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-[invalid=true]:border-destructive"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              disabled={formLocked}
              placeholder="@handle or you@example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={lookup.status === "invalid" || lookup.status === "error" ? true : undefined}
              aria-describedby="send-recipient-status"
            />
            <LookupStatus lookup={lookup} onRetry={() => setLookupRetry((value) => value + 1)} />
          </div>
          {stage !== "complete" ? (
            walletConnected ? (
              <MotionPillButton
                data-testid="send-submit"
                className="w-full min-h-12 text-base"
                disabled={
                  busy
                  || !routesReady
                  || !privateReady
                  || !sourceReady
                  || !recipientReady
                }
                aria-busy={busy || lookup.status === "checking"}
                onClick={() => void run()}
              >
                {busy ? (
                  <TextShimmer className="text-base font-semibold">{stageLabel(stage, denom)}</TextShimmer>
                ) : (
                  <><Send className="size-4" aria-hidden />{stageLabel("idle", denom)}</>
                )}
              </MotionPillButton>
            ) : (
              <MotionPillButton
                data-testid="connect-source"
                className="w-full min-h-12 text-base"
                disabled={
                  connecting
                  || busy
                  || !routesReady
                  || !privateReady
                  || !sourceReady
                }
                aria-busy={connecting}
                onClick={() => void connectSourceWallet()}
              >
                {connecting ? (
                  <TextShimmer className="text-base font-semibold">Connecting…</TextShimmer>
                ) : (
                  <><Wallet className="size-4" aria-hidden />{connectLabel}</>
                )}
              </MotionPillButton>
            )
          ) : null}
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
