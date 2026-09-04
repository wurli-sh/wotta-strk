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
  PrivateRouteToggleSkeleton,
  SendPageSkeleton,
  SourceChipsSkeleton,
} from "@/components/ui/Skeleton";
import { TextShimmer } from "@/components/ui/TextShimmer";
import {
  PAGE_SUBTITLES,
  SETTLED_PRIVATELY,
  SETTLED_PRIVATELY_INBOX,
  SUCCESS_NOTE_PIPELINE,
  TOAST,
  TRUTH_LINE_SHORT,
} from "@/lib/brand-copy";
import { PrivateRouteToggle } from "@/features/send/PrivateRouteToggle";
import { NOX_ROUTE_ID, PUBLIC_DEFAULT_ROUTE_ID } from "@/features/send/routeIds";
import {
  irisMessageUrl,
  sourceTxExplorerLabel,
  sourceTxExplorerUrl,
} from "@/features/send/sourceExplorer";
import { useRoutesHealth } from "@/features/send/useRoutesHealth";
import { apiFetch } from "@/lib/api/client";
import { fetchMe, getAccessToken } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { MAINNET_DISPLAY_DENS, coerceMainnetDenomination, denominationBaseUnits, isMainnetDenomination, type Dens } from "@/lib/denoms";
import { userFacingError } from "@/lib/errors";
import { starkscanTransactionUrl, readNetworkMode, type NetworkMode } from "@/lib/network-mode";
import { requireSourceWallet } from "@/lib/wallet-install";
import type { ProofPhase } from "@/lib/wotta/privacy-proof";
import {
  createBrowserProductSession,
  type FundingStage,
} from "@/lib/wotta/product-session";
import { connectReady } from "@/lib/wotta/ready";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { beginNetworkOperation, type NetworkOperation } from "@/lib/network-operations";
import { mainnetPrivacyConfig } from "@/lib/wotta/mainnet-privacy";

type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "registered" }
  | { status: "linked" }
  | { status: "pending" }
  | { status: "invalid" | "error" };

type SendStage = "idle" | FundingStage | ProofPhase | "unlocking_private" | "shielding_private" | "complete";
type DeliveryMode = "inbox" | "pending";

const PENDING_TTL_DAYS = 7;
const CROSS_CHAIN_ROUTES = new Set<WottaSourceRoute>([
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
]);
const KEEPER_DELAY_MS = 900_000;


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

function testnetDenomination(value: Dens): Denomination {
  if (value === "0.1") throw new Error("unsupported_testnet_denomination");
  return denominationBaseUnits(value).toString() as Denomination;
}

function stageLabel(stage: SendStage, denom: Dens): string {
  const labels: Record<SendStage, string> = {
    idle: `Send ${denom} USDC`,
    resolving: "Resolving recipient…",
    quoting: "Verifying quote…",
    delivering: "Encrypting delivery…",
    connecting_source: "Connecting source wallet…",
    approving: "Approve USDC…",
    depositing: "Deposit to Wotta…",
    burning: "Confirm CCTP burn…",
    confirming: "Confirming source transaction…",
    attesting: "Waiting for Circle attestation…",
    settling: "Settling privately on Starknet…",
    unlocking_private: "Unlocking private balance…",
    shielding_private: `Shielding & sending ${denom} USDC…`,
    waiting_confirmations: "Waiting for a proof-safe block…",
    building_proof: "Building private transfer…",
    signing_message: "Authorize in wallet…",
    generating_proof: "Generating private proof…",
    submitting: "Submitting proof…",
    complete: SETTLED_PRIVATELY,
  };
  return labels[stage];
}

function lookupTone(status: Lookup["status"]): string {
  if (status === "registered") return "border-success/25 bg-success/10 text-success";
  if (status === "linked" || status === "pending") return "border-warning-border bg-warning-surface text-warning";
  if (status === "invalid" || status === "error") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (status === "checking") return "border-brand-muted bg-brand-soft text-brand-ink";
  return "border-border bg-muted text-muted-foreground";
}

function LookupStatus({ lookup, onRetry, mode }: { lookup: Lookup; onRetry: () => void; mode: NetworkMode }) {
  const mainnet = mode === "mainnet";
  const rows: Record<Lookup["status"], { label: string; detail: string }> = {
    idle: { label: "Required", detail: "Enter an @handle or email" },
    checking: { label: "Checking", detail: "Looking up this recipient…" },
    registered: mainnet
      ? { label: "Mainnet ready", detail: "Claim goes to their encrypted inbox, then private balance" }
      : { label: "On Wotta", detail: "Claim goes to their encrypted inbox" },
    linked: { label: "Ready linked", detail: "Enable private tokens in Ready, then refresh" },
    pending: mainnet
      ? { label: "Not registered", detail: "Recipient must join Wotta and link Ready on Mainnet" }
      : { label: "Not joined", detail: `Claim held for ${PENDING_TTL_DAYS} days` },
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
      {lookup.status === "error" || (mainnet && lookup.status === "linked") ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-10 rounded-full px-3 text-xs font-semibold text-brand-ink outline-none transition-colors hover:bg-brand-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {lookup.status === "linked" ? "Refresh" : "Retry"}
        </button>
      ) : null}
    </div>
  );
}

function preferredPrivateRoute(routes: RouteRow[]): SourceRail | null {
  return routes.find((route) => route.key === PUBLIC_DEFAULT_ROUTE_ID && route.selectable)?.key
    ?? routes.find((route) => route.key === NOX_ROUTE_ID && route.selectable)?.key
    ?? routes.find((route) => route.key === "solana" && route.selectable)?.key
    ?? null;
}

function preferredPublicRoute(routes: RouteRow[]): SourceRail | null {
  return routes.find((route) => route.key === "starknet-public" && route.selectable)?.key
    ?? routes.find((route) => route.key !== NOX_ROUTE_ID && route.selectable)?.key
    ?? null;
}

function SendForm({ mode }: { mode: NetworkMode }) {
  const mainnet = mode === "mainnet";
  const {
    setSource: rememberSource,
    getSource,
    matchesRoute,
  } = useSourceWallet();
  const { routes, routesHealth, routesReady, retryRoutesHealth } = useRoutesHealth(mode);
  const [denom, setDenom] = useState<Dens>(mainnet ? "0.1" : 1n);
  const [recipient, setRecipient] = useState("");
  const [confidentialMode, setConfidentialMode] = useState(mainnet);
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
  const [pendingSourceTx, setPendingSourceTx] = useState<string | null>(null);
  const [keeperStartedAt, setKeeperStartedAt] = useState<number | null>(null);
  const [showSelfSettle, setShowSelfSettle] = useState(false);
  const [resolvedPrivateRecipient, setResolvedPrivateRecipient] = useState<string | null>(null);
  const lookupRequest = useRef(0);
  const activeSendOperation = useRef<NetworkOperation | null>(null);

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
  // Labels derive from selected source, never from confidentialMode alone.
  const connectLabel = isStarknetSource(source)
    ? "Connect Ready wallet"
    : source === "solana"
      ? "Connect Phantom wallet"
      : `Connect ${sourceLabel} wallet`;
  const allowCrossChainPrivateSources = mainnet && confidentialMode;

  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to) setRecipient(to);
  }, []);

  useEffect(() => {
    if (!mainnet) return;
    setConfidentialMode(true);
  }, [mainnet]);

  useEffect(() => {
    if (!mainnet) return;
    setDenom((current) => coerceMainnetDenomination(current));
  }, [mainnet, denom]);

  useEffect(() => {
    if (!routesReady) return;
    if (confidentialMode) {
      if (!mainnet) {
        setSource(NOX_ROUTE_ID);
        return;
      }
      setSource((current) => {
        const selected = routes.find((route) => route.key === current);
        if (selected?.selectable) return current;
        return preferredPrivateRoute(routes) ?? current;
      });
      return;
    }
    setSource((current) => {
      if (!isStarknetSource(current)) return current;
      return "starknet-public";
    });
  }, [mainnet, routes, routesReady, confidentialMode]);

  useEffect(() => {
    if (!routesReady || confidentialMode) return;
    setSource((current) => {
      const selected = routes.find((route) => route.key === current);
      if (selected?.selectable) return current;
      return preferredPublicRoute(routes) ?? current;
    });
  }, [routes, routesReady, confidentialMode]);

  function onConfidentialModeChange(enabled: boolean) {
    if (mainnet) return;
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
  const recipientReady = lookup.status === "registered" || (!confidentialMode && !mainnet && lookup.status === "pending");
  const formLocked = busy || stage === "complete";
  const selfSettleUrl = pendingSourceTx ? irisMessageUrl(source, pendingSourceTx, mode) : null;

  useEffect(() => () => activeSendOperation.current?.cancel(), []);

  useEffect(() => {
    const keeperStage = stage === "confirming" || stage === "attesting" || stage === "settling";
    if (keeperStage) {
      setKeeperStartedAt((current) => current ?? Date.now());
      return;
    }
    if (stage === "complete") {
      setShowSelfSettle(false);
      setKeeperStartedAt(null);
      return;
    }
    // Keep self-settle visible after timeout/error while a burn hash is known.
    if (stage === "idle" && !pendingSourceTx) {
      setShowSelfSettle(false);
      setKeeperStartedAt(null);
    }
  }, [stage, pendingSourceTx]);

  useEffect(() => {
    if (keeperStartedAt == null) return;
    const remaining = KEEPER_DELAY_MS - (Date.now() - keeperStartedAt);
    const timer = window.setTimeout(() => setShowSelfSettle(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [keeperStartedAt]);

  function unlockAfterReadyClosed() {
    const operation = activeSendOperation.current;
    if (!operation) return;
    operation.cancel();
    activeSendOperation.current = null;
    setBusy(false);
    setStage("idle");
    toast.message("Ready confirmation was closed. Nothing was sent — you can retry.");
  }

  useEffect(() => {
    const request = ++lookupRequest.current;
    setResolvedPrivateRecipient(null);
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      setLookup(recipient.trim() ? { status: "invalid" } : { status: "idle" });
      return;
    }
    setLookup({ status: "checking" });
    const operation = beginNetworkOperation(mode);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const token = await getAccessToken();
          if (!token) {
            if (operation.signal.aborted || request !== lookupRequest.current) return;
            setLookup({ status: "idle" });
            return;
          }
          const result = await apiFetch<{ descriptor: {
            registered: boolean;
            privateReady?: boolean;
            recipientProfileRef?: string;
            recipientPrivateIdentityAddress?: string;
            privacyPoolAddress?: string;
          } }>("/v1/resolve", {
            token,
            method: "POST",
            body: parsed,
            network: mode,
            signal: operation.signal,
          });
          operation.assertActive();
          if (request !== lookupRequest.current) return;
          if (mainnet) {
            let descriptor = result.descriptor;
            if (descriptor.registered && !descriptor.privateReady && descriptor.recipientProfileRef) {
              const meResult = await fetchMe(token, "mainnet");
              operation.assertActive();
              if (
                meResult.ok
                && meResult.data.profile?.id === descriptor.recipientProfileRef
                && meResult.data.wallet?.chain_id === "SN_MAIN"
              ) {
                try {
                  await apiFetch("/v1/wallet/private-identity", {
                    token,
                    method: "POST",
                    body: { identityAddress: meResult.data.wallet.address },
                    network: "mainnet",
                    signal: operation.signal,
                    suppressServiceStatus: true,
                  });
                  const refreshed = await apiFetch<typeof result>("/v1/resolve", {
                    token,
                    method: "POST",
                    body: parsed,
                    network: "mainnet",
                    signal: operation.signal,
                    suppressServiceStatus: true,
                  });
                  descriptor = refreshed.descriptor;
                } catch {
                  // Ready privacy is not registered yet. Keep the linked state
                  // and show its explicit Enable private tokens recovery path.
                }
              }
            }
            const poolMatches = (() => {
              try {
                return Boolean(descriptor.privacyPoolAddress)
                  && BigInt(descriptor.privacyPoolAddress!) === BigInt(mainnetPrivacyConfig().poolAddress);
              } catch {
                return false;
              }
            })();
            if (!descriptor.privateReady || !descriptor.recipientPrivateIdentityAddress || !poolMatches) {
              setLookup({ status: descriptor.registered ? "linked" : "pending" });
              return;
            }
            setResolvedPrivateRecipient(descriptor.recipientPrivateIdentityAddress);
            setLookup({ status: "registered" });
            return;
          }
          setLookup({ status: result.descriptor.registered ? "registered" : "pending" });
        } catch (error) {
          if (operation.signal.aborted || request !== lookupRequest.current) return;
          if (error instanceof Error && /sign in/i.test(error.message)) {
            setLookup({ status: "idle" });
          } else {
            setLookup({ status: "error" });
          }
        } finally {
          operation.finish();
        }
      })();
    }, 450);
    return () => {
      operation.cancel();
      window.clearTimeout(timer);
    };
  }, [mainnet, mode, recipient, lookupRetry]);

  async function connectSourceWallet() {
    if (connecting || busy) return;
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    setConnecting(true);
    try {
      if (isStarknetSource(source)) {
        const connected = await connectReady(mode);
        operation.assertActive();
        rememberSource({
          routeKey: source,
          family: "starknet",
          address: connected.address,
          label: confidentialMode ? "Private Starknet" : "Starknet",
        });
        toast.success(TOAST.readyConnected(mainnet ? "Mainnet" : "Testnet"));
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
          : await connectEvmSource(route, mainnet ? "mainnet" : "testnet");
      rememberSource({
        routeKey: source,
        family: familyForRoute(source),
        address,
        label: sourceLabel,
      });
      toast.success(TOAST.sourceConnected(sourceLabel));
    } catch (error) {
      const message = userFacingError(error, "Wallet connect failed");
      toast.error(message);
    } finally {
      operation.finish();
      setConnecting(false);
    }
  }

  async function run() {
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      toast.error(TOAST.invalidRecipient);
      return;
    }
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    activeSendOperation.current = operation;
    setBusy(true);
    setDelivery(null);
    setPendingSourceTx(null);
    setKeeperStartedAt(null);
    setShowSelfSettle(false);
    try {
      const session = createBrowserProductSession();
      await session.syncSession();
      operation.assertActive();
      const me = await session.me();
      if (!me.wallet?.address) throw new Error("Link your Ready wallet from Account first");
      if (mainnet) {
        if (!resolvedPrivateRecipient || lookup.status !== "registered") {
          throw new Error("Recipient isn’t mainnet-ready yet");
        }
        if (!isMainnetDenomination(denom)) {
          throw new Error("Choose 0.1 or 1 USDC on Mainnet");
        }
        const denomination = denominationBaseUnits(denom).toString() as Denomination;
        if (source === "starknet-private") {
          const result = await session.fundFromStarknetEscrow({
            denomination,
            recipient: parsed.identifier,
            publicRefundRecipient: me.wallet.address,
            linkedReadyAddress: me.wallet.address,
            onStage: setStage,
          });
          operation.assertActive();
          setDelivery("inbox");
          setSuccessRecipient(parsed.identifier);
          setSuccessTx(result.sourceTxHash);
          setSuccessRoute(NOX_ROUTE_ID);
          rememberSource({
            routeKey: NOX_ROUTE_ID,
            family: "starknet",
            address: result.sourceAccount,
            label: "Starknet escrow",
          });
          setStage("complete");
          toast.success(SETTLED_PRIVATELY_INBOX);
          return;
        }
        if (source === "base" || source === "solana") {
          const result = await session.fundFromCircleSource({
            route: source,
            denomination,
            recipient: parsed.identifier,
            publicRefundRecipient: me.wallet.address,
            onStage: (next) => {
              setStage(next);
              if (next === "confirming" || next === "attesting" || next === "settling") {
                setKeeperStartedAt((current) => current ?? Date.now());
              }
            },
            onSourceTxHash: setPendingSourceTx,
          });
          operation.assertActive();
          setDelivery("inbox");
          setSuccessRecipient(parsed.identifier);
          setSuccessTx(result.sourceTxHash);
          setSuccessRoute(source);
          rememberSource({
            routeKey: source,
            family: source === "solana" ? "solana" : "evm",
            address: result.sourceAccount,
            label: routes.find((route) => route.key === source)?.label,
          });
          setStage("complete");
          toast.success(SETTLED_PRIVATELY_INBOX);
          return;
        }
        throw new Error("This source is not available on Mainnet yet");
      }
      if (source === "starknet-private") {
        const result = await session.fundFromStarknetEscrow({
          denomination: testnetDenomination(denom),
          recipient: parsed.identifier,
          publicRefundRecipient: me.wallet.address,
          linkedReadyAddress: me.wallet.address,
          privateDelivery: true,
          onStage: setStage,
        });
        setDelivery("inbox");
        setSuccessRecipient(parsed.identifier);
        setSuccessTx(result.sourceTxHash);
        setSuccessRoute(source);
        rememberSource({
          routeKey: source,
          family: "starknet",
          address: result.sourceAccount,
          label: "Starknet escrow",
        });
        setStage("complete");
        toast.success(SETTLED_PRIVATELY_INBOX);
        return;
      }
      if (source === "starknet-public") {
        const result = await session.fundFromStarknetEscrow({
          denomination: testnetDenomination(denom),
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
        toast.success(SETTLED_PRIVATELY);
        return;
      }
      if (!CROSS_CHAIN_ROUTES.has(source as WottaSourceRoute)) {
        throw new Error("This source is not available yet");
      }
      const result = await session.fundFromCircleSource({
        route: source as WottaSourceRoute,
        denomination: testnetDenomination(denom),
        recipient: parsed.identifier,
        publicRefundRecipient: me.wallet.address,
        onStage: (next) => {
          setStage(next);
          if (next === "confirming" || next === "attesting" || next === "settling") {
            setKeeperStartedAt((current) => current ?? Date.now());
          }
        },
        onSourceTxHash: setPendingSourceTx,
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
      toast.success(SETTLED_PRIVATELY);
    } catch (error) {
      if (operation.signal.aborted) return;
      const message = userFacingError(error, "Couldn’t send");
      if (/sign in/i.test(message)) setAuthOpen(true);
      if (/settlement is still finishing|continues in the background|still pending/i.test(message)) {
        toast.message(message);
      } else {
        toast.error(message);
      }
      setStage("idle");
    } finally {
      operation.finish();
      if (activeSendOperation.current === operation) activeSendOperation.current = null;
      setBusy(false);
    }
  }

  if (stage === "complete" && delivery) {
    const heldUntil = new Date(Date.now() + PENDING_TTL_DAYS * 86_400_000);
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <NoteVisaCard
          label={delivery === "inbox" ? "In their inbox" : "Waiting for join"}
          amount={String(denom)}
          recipient={successRecipient}
          status={delivery === "inbox" ? "Claimable" : "On hold"}
          note={delivery === "pending"
            ? `Held until ${heldUntil.toLocaleDateString()}`
            : SUCCESS_NOTE_PIPELINE}
          footer={
            <div className="space-y-2">
              <MotionPillButton className="w-full" onClick={() => { setStage("idle"); setDelivery(null); setSuccessTx(null); setSuccessRoute(null); }}>
                Send another
              </MotionPillButton>
              {successTx ? (
                <Button
                  variant="outline"
                  className="w-full"
                  href={
                    mainnet && successRoute && isStarknetSource(successRoute)
                      ? starkscanTransactionUrl("mainnet", successTx)
                      : sourceTxExplorerUrl(successRoute, successTx, mode)
                  }
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
          <DenomChips
            value={denom}
            onChange={setDenom}
            disabled={formLocked}
            denominations={mainnet ? MAINNET_DISPLAY_DENS : undefined}
            comingSoon={mainnet ? MAINNET_DISPLAY_DENS.filter((d) => !isMainnetDenomination(d)) : undefined}
          />
        </div>
        <div className="space-y-5 px-3 pb-3 pt-5 sm:px-4 sm:pb-4">
          {!mainnet ? (
            routesReady ? (
              <PrivateRouteToggle
                enabled={confidentialMode}
                disabled={formLocked}
                onChange={onConfidentialModeChange}
              />
            ) : (
              <PrivateRouteToggleSkeleton />
            )
          ) : null}

          {routesReady ? (
            <SourceChips
              routes={routes}
              value={source}
              onChange={setSource}
              disabled={formLocked}
              privateMode={confidentialMode}
              allowCrossChainPrivateSources={allowCrossChainPrivateSources}
            />
          ) : routesHealth === "waking" ? (
            <div
              className="radius-surface-inner space-y-2 border border-warning-border bg-warning-surface px-4 py-3 text-xs text-warning-foreground"
              role="status"
            >
              <p>API is waking up — chain selection unlocks when route health is back.</p>
              <button
                type="button"
                onClick={retryRoutesHealth}
                className="text-xs font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (
            <SourceChipsSkeleton />
          )}

          {!mainnet && confidentialMode && routesReady && !privateReady ? (
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
            <LookupStatus lookup={lookup} mode={mode} onRetry={() => setLookupRetry((value) => value + 1)} />
          </div>
          {CROSS_CHAIN_ROUTES.has(source as WottaSourceRoute) || source === NOX_ROUTE_ID ? (
            <p className="text-xs leading-5 text-muted-foreground" role="note">
              {TRUTH_LINE_SHORT}{" "}
              <a className="font-medium text-foreground underline underline-offset-4" href="/privacy">
                Details
              </a>
            </p>
          ) : null}
          {stage !== "complete" ? (
            walletConnected ? (
              <div>
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
                {showSelfSettle && pendingSourceTx ? (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground" role="status">
                    Taking longer than expected. Your burn is complete and cannot be cancelled.
                    Closing this page does not cancel it.
                    {selfSettleUrl ? (
                      <>
                        {" "}You can{" "}
                        <a
                          className="font-medium text-foreground underline underline-offset-4"
                          href={selfSettleUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          settle this yourself
                        </a>{" "}
                        using your Circle message.
                      </>
                    ) : null}
                  </p>
                ) : null}
                {busy && mainnet ? (
                  <button
                    type="button"
                    className="mx-auto mt-3 block text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={unlockAfterReadyClosed}
                  >
                    Cancel and unlock Send
                  </button>
                ) : null}
              </div>
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
  const { mode } = useNetworkMode();
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
      subtitle={
        tab === "claim" ? PAGE_SUBTITLES.claim : PAGE_SUBTITLES.send
      }
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
      {tab === "claim" ? (
        <ClaimView embedded noteId={noteId} />
      ) : (
        <SendForm key={mode} mode={mode} />
      )}
    </PageShell>
  );
}

export function SendPage() {
  const { mode } = useNetworkMode();
  const skeletonMode = mode === "mainnet" || readNetworkMode() === "mainnet"
    ? "mainnet"
    : "testnet";
  return (
    <Suspense fallback={<SendPageSkeleton mode={skeletonMode} />}>
      <SendPageInner />
    </Suspense>
  );
}
