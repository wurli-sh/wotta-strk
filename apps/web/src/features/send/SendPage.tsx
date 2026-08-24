"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ExternalLink, Send, Wallet } from "lucide-react";
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
import { fetchMe, getAccessToken, syncWottaSession } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { MAINNET_DENS, denominationBaseUnits, type Dens } from "@/lib/denoms";
import { userFacingError } from "@/lib/errors";
import { starkscanTransactionUrl, type NetworkMode } from "@/lib/network-mode";
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
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { beginNetworkOperation, type NetworkOperation } from "@/lib/network-operations";
import { WrongModeNotice } from "@/components/WrongModeNotice";
import {
  MAINNET_USDC_PRIVACY_FEE_RESERVE,
  mainnetPrivacyConfig,
  readMainnetPrivateBalance,
  readMainnetPublicStrkBalance,
  readMainnetPublicUsdcBalance,
  submitMainnetPrivacyAction,
  submitMainnetShieldedTransfer,
} from "@/lib/wotta/mainnet-privacy";
import { recordMainnetEvidence } from "@/lib/wotta/mainnet-evidence";

type Lookup =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "registered" }
  | { status: "linked" }
  | { status: "pending" }
  | { status: "invalid" | "error" };

type SendStage = "idle" | FundingStage | ProofPhase | "unlocking_private" | "shielding_private" | "complete";
type DeliveryMode = "inbox" | "pending" | "direct";

const PENDING_TTL_DAYS = 7;
const CROSS_CHAIN_ROUTES = new Set<WottaSourceRoute>([
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
]);

const MAINNET_SOURCE_ROUTES: RouteRow[] = [
  { key: "ethereum", label: "Ethereum", status: "soon", selectable: false, reason: "Not available on Mainnet" },
  { key: "arbitrum", label: "Arbitrum", status: "soon", selectable: false, reason: "Not available on Mainnet" },
  { key: "base", label: "Base", status: "soon", selectable: false, reason: "Not available on Mainnet" },
  { key: "solana", label: "Solana", status: "soon", selectable: false, reason: "Not available on Mainnet" },
  { key: "stellar", label: "Stellar", status: "soon", selectable: false, reason: "Not available on Mainnet" },
  { key: "starknet-public", label: "Starknet", status: "live", selectable: false, reason: "Mainnet uses the private Starknet route" },
  { key: "starknet-private", label: "Starknet", status: "live", selectable: true },
];

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
    depositing: "Deposit to Wotta escrow…",
    burning: "Confirm CCTP burn…",
    confirming: "Confirming source transaction…",
    attesting: "Waiting for Circle attestation…",
    settling: "Settling privately on Starknet…",
    unlocking_private: "Unlocking private balance…",
    shielding_private: `Shielding & sending ${denom} USDC…`,
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
      ? { label: "Mainnet ready", detail: "Private payment goes directly to their Ready balance" }
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
  const testnetRoutes = useRoutesHealth(!mainnet);
  const routes = mainnet ? MAINNET_SOURCE_ROUTES : testnetRoutes.routes;
  const routesHealth = testnetRoutes.routesHealth;
  const routesReady = mainnet || testnetRoutes.routesReady;
  const retryRoutesHealth = testnetRoutes.retryRoutesHealth;
  const [denom, setDenom] = useState<Dens>(mainnet ? "0.1" : 1n);
  const [recipient, setRecipient] = useState("");
  const [confidentialMode, setConfidentialMode] = useState(mainnet);
  const [source, setSource] = useState<SourceRail>(mainnet ? NOX_ROUTE_ID : PUBLIC_DEFAULT_ROUTE_ID);
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
  const [resolvedPrivateRecipient, setResolvedPrivateRecipient] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [mainnetShieldedDuringSend, setMainnetShieldedDuringSend] = useState(false);
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
  // Swoop: `Connect ${routeLabel(routeId)} wallet` — always include "wallet".
  const connectLabel = isStarknetSource(source) || confidentialMode
    ? "Connect Ready wallet"
    : `Connect ${sourceLabel} wallet`;

  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get("to");
    if (to) setRecipient(to);
  }, []);

  useEffect(() => {
    if (mainnet) return;
    if (!routesReady) return;
    if (confidentialMode) {
      setSource(NOX_ROUTE_ID);
      return;
    }
    setSource((current) => {
      if (!isStarknetSource(current)) return current;
      return "starknet-public";
    });
  }, [mainnet, routes, routesReady, confidentialMode]);

  useEffect(() => {
    if (mainnet) return;
    if (!routesReady || confidentialMode) return;
    setSource((current) => {
      const selected = routes.find((route) => route.key === current);
      if (selected?.selectable) return current;
      return preferredPublicRoute(routes) ?? current;
    });
  }, [mainnet, routes, routesReady, confidentialMode]);

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
  const recipientReady = lookup.status === "registered" || (!mainnet && lookup.status === "pending");
  const formLocked = busy || stage === "complete";

  useEffect(() => () => activeSendOperation.current?.cancel(), []);

  function unlockAfterReadyClosed() {
    const operation = activeSendOperation.current;
    if (!operation) return;
    operation.cancel();
    activeSendOperation.current = null;
    setBusy(false);
    setStage("idle");
    setInlineError("Ready confirmation was closed. Nothing was sent — you can retry.");
    toast.message("Ready request closed — Send is unlocked");
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
    setInlineError(null);
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
        toast.success(`Ready wallet connected on ${mainnet ? "Mainnet" : "Testnet"}`);
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
      const message = userFacingError(error, "Wallet connect failed");
      setInlineError(message);
      toast.error(message);
    } finally {
      operation.finish();
      setConnecting(false);
    }
  }

  async function connectedMainnetAccount() {
    const token = await getAccessToken();
    if (!token) throw new Error("sign_in_required");
    await syncWottaSession({ notify: false });
    const meResult = await fetchMe(token, "mainnet");
    if (!meResult.ok || !meResult.data.wallet) {
      throw new Error("Link your Ready mainnet wallet from Account first");
    }
    if (meResult.data.wallet.chain_id !== "SN_MAIN") throw new Error("mainnet_wallet_not_linked");
    const connected = await connectReady("mainnet");
    if (BigInt(connected.address) !== BigInt(meResult.data.wallet.address)) {
      throw new Error("Connect the Ready mainnet account linked to this Wotta profile");
    }
    return { token, me: meResult.data, connected };
  }

  async function run() {
    const parsed = parseRecipient(recipient);
    if (!parsed) {
      toast.error("Enter a valid @handle or email");
      return;
    }
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    activeSendOperation.current = operation;
    setBusy(true);
    setMainnetShieldedDuringSend(false);
    setInlineError(null);
    setDelivery(null);
    try {
      if (mainnet) {
        if (!resolvedPrivateRecipient || lookup.status !== "registered") {
          throw new Error("Recipient isn’t mainnet-ready yet");
        }
        setStage("connecting_source");
        const { token, connected } = await connectedMainnetAccount();
        operation.assertActive();
        setStage("resolving");
        const resolved = await apiFetch<{ descriptor: {
          privateReady?: boolean;
          recipientPrivateIdentityAddress?: string;
          privacyPoolAddress?: string;
        } }>("/v1/resolve", {
          token,
          method: "POST",
          body: parsed,
          network: "mainnet",
          signal: operation.signal,
        });
        operation.assertActive();
        const descriptor = resolved.descriptor;
        const config = mainnetPrivacyConfig();
        let poolMatches = false;
        try {
          poolMatches = Boolean(descriptor.privacyPoolAddress)
            && BigInt(descriptor.privacyPoolAddress!) === BigInt(config.poolAddress);
        } catch {
          poolMatches = false;
        }
        if (!descriptor.privateReady || !descriptor.recipientPrivateIdentityAddress || !poolMatches) {
          throw new Error("Recipient isn’t ready for private payments on Starknet Mainnet");
        }
        const amount = denominationBaseUnits(denom);
        const [privateBalance, publicBalance, strkBalance] = await Promise.all([
          readMainnetPrivateBalance(connected.account),
          readMainnetPublicUsdcBalance(connected.account),
          readMainnetPublicStrkBalance(connected.account),
        ]);
        operation.assertActive();
        const requiredPrivateBalance = amount + MAINNET_USDC_PRIVACY_FEE_RESERVE;
        const needsShield = privateBalance < requiredPrivateBalance;
        const shieldAmount = needsShield ? requiredPrivateBalance - privateBalance : 0n;
        if (needsShield && publicBalance < shieldAmount) {
          const requiredPublicUsdc = Number(shieldAmount) / 1_000_000;
          throw new Error(`Need at least ${requiredPublicUsdc} native USDC in Ready to cover the payment and privacy fee reserve`);
        }
        if (strkBalance < config.protocolFeeStrk) throw new Error("Need at least 6 STRK plus network gas in this Ready mainnet account");
        setStage(needsShield ? "shielding_private" : "building_proof");
        const transactionHash = needsShield
          ? await submitMainnetShieldedTransfer(
              connected.account,
              descriptor.recipientPrivateIdentityAddress,
              operation.signal,
              amount,
              shieldAmount,
            )
          : await submitMainnetPrivacyAction(
              connected.account,
              "transfer",
              descriptor.recipientPrivateIdentityAddress,
              operation.signal,
              amount,
            );
        operation.assertActive();
        recordMainnetEvidence(needsShield ? "shield-transfer" : "transfer", transactionHash);
        setMainnetShieldedDuringSend(needsShield);
        if (needsShield) {
          try {
            await apiFetch("/v1/wallet/private-identity", {
              token,
              method: "POST",
              body: { identityAddress: connected.address },
              network: "mainnet",
              signal: operation.signal,
            });
            setLookupRetry((value) => value + 1);
          } catch {
            // The payment is already confirmed. A later Account reconnect can
            // repair this sender's Wotta recipient-readiness metadata.
          }
        }
        setDelivery("direct");
        setSuccessRecipient(parsed.identifier);
        setSuccessTx(transactionHash);
        setSuccessRoute(NOX_ROUTE_ID);
        setStage("complete");
        toast.success(needsShield ? "USDC shielded and sent privately" : "Private Mainnet transfer confirmed");
        return;
      }
      const session = createBrowserProductSession();
      await session.syncSession();
      operation.assertActive();
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
          BigInt(testnetDenomination(denom)),
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
        toast.success("Escrowed on Starknet");
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
      if (operation.signal.aborted) return;
      const message = userFacingError(error, "Couldn’t send");
      setInlineError(message);
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
          label={delivery === "direct" ? "Private transfer" : delivery === "inbox" ? "In their inbox" : "Waiting for join"}
          amount={String(denom)}
          recipient={successRecipient}
          status={delivery === "direct" ? "Received privately" : delivery === "inbox" ? "Claimable" : "On hold"}
          note={delivery === "pending"
            ? `Held until ${heldUntil.toLocaleDateString()}`
            : delivery === "direct"
              ? mainnet && mainnetShieldedDuringSend
                ? "Ready USDC → shielded → recipient private balance"
                : "Private balance → private balance"
              : "Claim → private Starknet balance"}
          footer={
            <div className="space-y-2">
              <MotionPillButton className="w-full" onClick={() => { setStage("idle"); setDelivery(null); setSuccessTx(null); setSuccessRoute(null); setMainnetShieldedDuringSend(false); }}>
                Send another
              </MotionPillButton>
              {successTx ? (
                <Button
                  variant="outline"
                  className="w-full"
                  href={mainnet ? starkscanTransactionUrl("mainnet", successTx) : sourceTxExplorerUrl(successRoute, successTx)}
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
            denominations={mainnet ? MAINNET_DENS : undefined}
          />
        </div>
        <div className="space-y-5 px-3 pb-3 pt-5 sm:px-4 sm:pb-4">
          {mainnet ? (
            <div className="radius-surface-inner border border-warning-border bg-warning-surface px-4 py-3 text-xs leading-5 text-warning-foreground" role="status">
              Mainnet uses real funds. Wotta automatically tops up the selected amount plus a private-fee reserve, then sends the selected amount privately. Each private transaction incurs the live pool fee plus network gas.
            </div>
          ) : null}
          <ConfidentialToggle
            enabled={confidentialMode}
            disabled={mainnet || formLocked || !routesReady}
            locked={mainnet}
            onChange={onConfidentialModeChange}
          />

          {routesReady ? (
            <SourceChips
              routes={routes}
              value={source}
              onChange={setSource}
              disabled={formLocked}
              privateMode={confidentialMode}
              unavailableReason={mainnet ? "Not available on Mainnet" : undefined}
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
          {inlineError ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-destructive">Couldn’t complete the action</p>
                <p className="mt-1 text-xs leading-5 text-foreground">{inlineError}</p>
              </div>
            </div>
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
                {busy && mainnet ? (
                  <button
                    type="button"
                    className="mx-auto mt-3 block text-xs font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={unlockAfterReadyClosed}
                  >
                    I closed Ready — unlock Send
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
        tab === "claim"
          ? mode === "mainnet"
            ? "Claim flows are not available on Mainnet."
            : "Claim USDC from your inbox into your private Starknet balance."
          : mode === "mainnet"
            ? "Pay an email or @handle privately through Starknet Mainnet."
            : "Pay an email or @handle from any admitted testnet source."
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
        mode === "mainnet" ? (
          <WrongModeNotice
            feature="Claim"
            detail="Not available on Mainnet. Private payments settle directly to registered Ready balances; switch to Testnet beta for escrow claims."
          />
        ) : (
          <ClaimView embedded noteId={noteId} />
        )
      ) : (
        <SendForm key={mode} mode={mode} />
      )}
    </PageShell>
  );
}

export function SendPage() {
  return <Suspense fallback={<SendPageSkeleton />}><SendPageInner /></Suspense>;
}
