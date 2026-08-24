"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, Check, ChevronDown, Copy, LogOut, Mail, Network, Wallet } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { toastNetworkModeEnabled } from "@/lib/network-mode-toast";
import { buttonTap, navSpring } from "@/lib/motion";
import { cn } from "@/lib/cn";
import {
  fetchMe,
  mergeMeResponse,
  signOutSupabase,
  syncWottaSession,
  type MeResponse,
  AUTH_SESSION_EVENT,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import { SignInModal } from "@/components/SignInModal";
import { GoogleIcon, XBrandIcon } from "@/components/icons";
import { routeLogoPath } from "@/lib/crypto-icons";
import type { SourceChipKey } from "@/components/SourceChips";
import {
  useSourceWallet,
  type ConnectedSourceWallet,
} from "@/components/SourceWalletProvider";
import { usePrivacyVault } from "@/components/PrivacyVaultProvider";
import { apiFetch } from "@/lib/api/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";

const NAV_LINKS = [
  ["/send", "Send"],
  ["/inbox", "Inbox"],
  ["/account", "Account"],
] as const;

type AuthProviderKind = "google" | "x" | "email";

function resolveAuthProviders(session: Session): AuthProviderKind[] {
  const identities = session.user.identities ?? [];
  const found = new Set<AuthProviderKind>();
  for (const identity of identities) {
    const provider = identity.provider;
    if (provider === "google") found.add("google");
    else if (provider === "twitter" || provider === "x") found.add("x");
    else if (provider === "email") found.add("email");
  }
  const meta = session.user.app_metadata?.provider;
  if (meta === "google") found.add("google");
  if (meta === "twitter" || meta === "x") found.add("x");
  if (meta === "email") found.add("email");
  if (found.size === 0 && session.user.email) found.add("email");
  return (["google", "x", "email"] as const).filter((k) => found.has(k));
}

function AuthProviderMark({
  kind,
  className,
}: {
  kind: AuthProviderKind;
  className?: string;
}) {
  if (kind === "google") return <GoogleIcon className={className} />;
  if (kind === "x") return <XBrandIcon className={className} />;
  return <Mail className={className} aria-hidden />;
}

function authLabel(kind: AuthProviderKind): string {
  if (kind === "google") return "Google";
  if (kind === "x") return "X";
  return "Email";
}

function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function chainLabel(chain: SourceChipKey): string {
  const labels: Record<SourceChipKey, string> = {
    ethereum: "Ethereum",
    arbitrum: "Arbitrum",
    base: "Base",
    solana: "Solana",
    stellar: "Stellar",
    starknet: "Starknet",
  };
  return labels[chain];
}

type WalletGroup = {
  address: string;
  chains: SourceChipKey[];
};

function groupWallets(sources: ConnectedSourceWallet[]): WalletGroup[] {
  const byAddress = new Map<string, SourceChipKey[]>();
  for (const source of sources) {
    const key = source.address;
    const list = byAddress.get(key) ?? [];
    if (!list.includes(source.chainKey)) list.push(source.chainKey);
    byAddress.set(key, list);
  }
  return [...byAddress.entries()].map(([address, chains]) => ({
    address,
    chains,
  }));
}

function networkRingClass(mode: "testnet" | "mainnet") {
  return mode === "mainnet"
    ? "ring-2 ring-mainnet-bright/45 ring-offset-2 ring-offset-nav"
    : "ring-2 ring-brand-sky/45 ring-offset-2 ring-offset-nav";
}

function NetworkChoices({
  mode,
  confirmMainnet,
  onSelect,
  onCancelMainnet,
}: {
  mode: "testnet" | "mainnet";
  confirmMainnet: boolean;
  onSelect: (mode: "testnet" | "mainnet") => void;
  onCancelMainnet: () => void;
}) {
  const reduce = useReducedMotion();
  const testnetOn = mode === "testnet";

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Network className="size-3.5 text-muted-foreground" aria-hidden />
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Network
            </p>
          </div>
          <motion.p
            key={testnetOn ? "testnet" : "mainnet"}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="mt-1 text-xs text-muted-foreground"
          >
            {testnetOn ? "Testnet beta" : "Mainnet — real funds"}
          </motion.p>
        </div>
        <motion.button
          type="button"
          role="switch"
          aria-checked={testnetOn}
          aria-label="Testnet mode"
          data-testid="testnet-mode-toggle"
          onClick={() => onSelect(testnetOn ? "mainnet" : "testnet")}
          whileTap={reduce ? undefined : buttonTap}
          animate={{
            backgroundColor: testnetOn
              ? "var(--color-brand)"
              : "var(--color-mainnet)",
            borderColor: testnetOn
              ? "var(--color-brand-muted)"
              : "var(--color-mainnet-border)",
          }}
          transition={reduce ? { duration: 0 } : navSpring}
          className="relative h-7 w-12 shrink-0 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <motion.span
            className="absolute top-0.5 size-5 rounded-full bg-card shadow-sm"
            animate={{ left: testnetOn ? 24 : 2 }}
            transition={reduce ? { duration: 0 } : navSpring}
            aria-hidden
          />
        </motion.button>
      </div>
      {confirmMainnet ? (
        <div
          className="mt-3 rounded-xl border border-mainnet-border/50 bg-card p-3 shadow-soft"
          role="alert"
        >
          <div className="flex gap-2.5 rounded-lg border border-mainnet-muted bg-mainnet-soft px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-mainnet-strong" aria-hidden />
            <p className="text-xs leading-5 text-foreground">
              Mainnet uses real USDC and STRK. Only Starknet private sends are enabled; 0.5 USDC is added to the existing amounts.
            </p>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => onSelect("mainnet")}
              className="min-h-10 flex-1 rounded-lg bg-mainnet-strong px-3 text-xs font-semibold text-mainnet-foreground transition-colors hover:bg-mainnet-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Use mainnet
            </button>
            <button
              type="button"
              onClick={onCancelMainnet}
              className="min-h-10 flex-1 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function IslandNav() {
  const { mode, setMode } = useNetworkMode();
  const pathname = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [confirmMainnet, setConfirmMainnet] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const lastSessionToken = useRef<string | null | undefined>(undefined);
  const { sources, clearSources } = useSourceWallet();
  const { clearVault } = usePrivacyVault();

  function prefetchInbox() {
    if (mode === "mainnet") return;
    if (!session?.access_token) return;
    void apiFetch("/v1/notes", {
      token: session.access_token,
      suppressServiceStatus: true,
    }).catch(() => {
      // Prefetch is an optimization only; the Inbox owns visible errors.
    });
  }

  function switchNetwork(next: "testnet" | "mainnet") {
    if (next === mode) {
      setConfirmMainnet(false);
      return;
    }
    if (next === "mainnet" && !confirmMainnet) {
      setConfirmMainnet(true);
      return;
    }
    if (!setMode(next)) {
      toast.error("Finish or cancel the open Ready request before switching networks");
      return;
    }
    setMe(null);
    setConfirmMainnet(false);
    setMenuOpen(false);
    setNetworkMenuOpen(false);
    toastNetworkModeEnabled(next);
    router.refresh();
  }

  async function refreshMe() {
    const res = await fetchMe();
    if (res.ok) setMe((prev) => mergeMeResponse(prev, res.data));
    else setMe(null);
  }

  async function onSessionEstablished() {
    await syncWottaSession();
    await refreshMe();
  }

  useEffect(() => {
    try {
      const supabase = createClient();
      void supabase.auth.getSession().then(({ data }) => {
        lastSessionToken.current = data.session?.access_token ?? null;
        setSession(data.session);
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        const token = s?.access_token ?? null;
        if (lastSessionToken.current === token) return;
        lastSessionToken.current = token;
        setSession(s);
      });
      return () => sub.subscription.unsubscribe();
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    if (session) void onSessionEstablished();
    else setMe(null);
  }, [session, mode]);

  useEffect(() => {
    function onSession() {
      if (session) void refreshMe();
    }
    window.addEventListener(AUTH_SESSION_EVENT, onSession);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, onSession);
  }, [session]);

  useEffect(() => {
    if (!menuOpen && !networkMenuOpen) return;
    function onPointer(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !networkMenuRef.current?.contains(target)) {
        setMenuOpen(false);
        setNetworkMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setNetworkMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, networkMenuOpen]);

  async function disconnectAuth() {
    setBusy(true);
    setMenuOpen(false);
    try {
      await signOutSupabase();
      clearVault();
      clearSources();
      setMe(null);
      setSession(null);
      toast.success("Signed out");
    } catch {
      toast.error("Sign-out failed");
    } finally {
      setBusy(false);
    }
    setSignInOpen(true);
    router.replace("/");
    router.refresh();
  }

  function disconnectWallet() {
    setMenuOpen(false);
    clearSources();
    toast.success("Wallet disconnected");
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      window.setTimeout(() => setCopiedAddress(null), 1_800);
    } catch {
      setCopiedAddress(null);
      toast.error("Couldn’t copy address");
    }
  }

  const authKinds = session ? resolveAuthProviders(session) : [];
  const primaryAuth = authKinds[0] ?? "email";
  const walletGroups = useMemo(() => groupWallets(sources), [sources]);
  const hasWallet = walletGroups.length > 0;
  const walletCount = walletGroups.reduce(
    (sum, group) => sum + group.chains.length,
    0,
  );
  const linkedReadyAddress = me?.wallet?.address ?? null;
  const connectedWalletGroups = useMemo(() => {
    if (!linkedReadyAddress) return walletGroups;
    return walletGroups.filter(
      (group) => group.address.toLowerCase() !== linkedReadyAddress.toLowerCase(),
    );
  }, [linkedReadyAddress, walletGroups]);
  const connectedWalletCount = connectedWalletGroups.reduce(
    (sum, group) => sum + group.chains.length,
    0,
  );
  const showLinkedReadyRow = Boolean(linkedReadyAddress);

  const xHandle =
    (session?.user.user_metadata?.user_name as string | undefined) ??
    (session?.user.user_metadata?.preferred_username as string | undefined) ??
    me?.identities.find((identity) => identity.provider === "x")?.normalized_identifier;
  const emailIdentity = me?.identities.find((identity) => identity.provider === "email" || identity.provider === "google")?.normalized_identifier;
  const accountSubtitle =
    primaryAuth === "x" && xHandle
      ? `@${String(xHandle).replace(/^@/, "")}`
      : (session?.user.email ??
        emailIdentity ??
        (xHandle ? `@${xHandle}` : "Signed in"));

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        <div className="radius-control pointer-events-auto grid w-full max-w-lg origin-top grid-cols-[1fr_auto_1fr] items-center bg-nav px-4 py-3.5 text-nav-foreground shadow-md shadow-primary/10 sm:max-w-xl sm:px-6">
          <Link href="/" className="justify-self-start pl-1 sm:pl-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/sable-logo-light.svg"
              alt="Wotta"
              className="h-5 w-auto"
              data-testid="brand-logo"
            />
          </Link>

          <LayoutGroup id="primary-navigation">
            <nav
              className="flex items-center justify-center gap-0.5 sm:gap-1"
              aria-label="Primary"
            >
              {NAV_LINKS.map(([href, label]) => {
                const active =
                  pathname === href ||
                  pathname.startsWith(`${href}/`) ||
                  (href === "/send" &&
                    (pathname === "/claim" ||
                      pathname.startsWith("/claim/") ||
                      pathname === "/c"));
                return (
                  <Link
                    key={href}
                    href={href}
                    onPointerEnter={label === "Inbox" ? prefetchInbox : undefined}
                    onFocus={label === "Inbox" ? prefetchInbox : undefined}
                    data-testid={`nav-${label.toLowerCase()}`}
                    className={cn(
                      "radius-control relative px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav sm:px-4 sm:text-sm",
                      active
                        ? "text-nav-foreground"
                        : "text-nav-foreground/75 hover:bg-nav-hover hover:text-nav-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="tab-panel"
                        initial={false}
                        transition={
                          reduce
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 360, damping: 36 }
                        }
                        className="radius-control absolute inset-0 bg-nav-active"
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </Link>
                );
              })}
            </nav>
          </LayoutGroup>

          <div className="justify-self-end pr-1 sm:pr-2">
            {session ? (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  aria-expanded={menuOpen}
                  aria-controls="account-menu"
                  aria-label="Account menu"
                  onClick={() => setMenuOpen((o) => !o)}
                  className={cn(
                    "radius-control flex cursor-pointer items-center gap-1.5 bg-nav-hover py-1 pl-1 pr-1.5 text-xs font-medium text-nav-foreground/80 transition-[background-color,color,box-shadow] duration-300 hover:bg-nav-active hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav sm:pr-2",
                    networkRingClass(mode),
                    menuOpen && "bg-nav-active text-nav-foreground",
                  )}
                >
                  <span className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
                    <AuthProviderMark
                      kind={primaryAuth}
                      className="size-3.5 text-nav-foreground"
                    />
                  </span>
                  {walletCount > 0 ? (
                    <span className="tabular-nums text-[11px] text-nav-foreground/70">
                      {walletCount}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      "size-3.5 opacity-70 transition-transform duration-150",
                      menuOpen && "rotate-180",
                    )}
                    aria-hidden
                  />
                </button>

                {menuOpen ? (
                  <section
                    id="account-menu"
                    aria-label="Account menu"
                    className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card"
                  >
                    <div className="bg-brand-mist/55 px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-brand-muted/70">
                          <AuthProviderMark
                            kind={primaryAuth}
                            className="size-4 text-brand-ink"
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            Signed in with {authLabel(primaryAuth)}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {accountSubtitle}
                          </p>
                        </div>
                      </div>
                      {authKinds.length > 1 ? (
                        <p className="mt-2.5 text-xs text-muted-foreground">
                          Also linked:{" "}
                          {authKinds
                            .filter((k) => k !== primaryAuth)
                            .map(authLabel)
                            .join(", ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="border-t border-border/60 px-3 py-3">
                      <NetworkChoices
                        mode={mode}
                        confirmMainnet={confirmMainnet}
                        onSelect={switchNetwork}
                        onCancelMainnet={() => setConfirmMainnet(false)}
                      />
                    </div>

                    {showLinkedReadyRow && linkedReadyAddress ? (
                      <div className="border-t border-border/60 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between px-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Linked Ready
                          </p>
                        </div>
                        <div
                          className={cn(
                            "flex items-center gap-2.5 rounded-xl border p-2.5",
                            mode === "mainnet"
                              ? "border-mainnet-border/70 bg-mainnet-soft/50"
                              : "border-border/70 bg-background/60",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={routeLogoPath("starknet")}
                            alt="Ready"
                            width={20}
                            height={20}
                            className="size-5 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-foreground">
                              Ready
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-muted-foreground">
                              {truncateAddress(linkedReadyAddress)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void copyAddress(linkedReadyAddress)}
                            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={
                              copiedAddress === linkedReadyAddress
                                ? "Ready address copied"
                                : "Copy Ready wallet address"
                            }
                          >
                            {copiedAddress === linkedReadyAddress ? (
                              <Check className="size-4 text-success" aria-hidden />
                            ) : (
                              <Copy className="size-4" aria-hidden />
                            )}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {connectedWalletGroups.length > 0 ? (
                      <div className="border-t border-border/60 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between px-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            Connected wallets
                          </p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                            {connectedWalletCount}{" "}
                            {connectedWalletCount === 1 ? "chain" : "chains"}
                          </span>
                        </div>
                        <ul className="space-y-2 font-sans">
                          {connectedWalletGroups.map((group) => (
                            <li
                              key={group.address}
                              className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-background/60 p-2.5"
                            >
                              <span className="flex shrink-0 items-center gap-1">
                                {group.chains.map((chain) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={chain}
                                    src={routeLogoPath(chain)}
                                    alt={chainLabel(chain)}
                                    title={chainLabel(chain)}
                                    width={20}
                                    height={20}
                                    className="size-5"
                                  />
                                ))}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground">
                                  {group.chains.map(chainLabel).join(" · ")}
                                </p>
                                <p className="truncate text-[11px] tabular-nums text-muted-foreground">
                                  {truncateAddress(group.address)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void copyAddress(group.address)}
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                aria-label={
                                  copiedAddress === group.address
                                    ? "Wallet address copied"
                                    : `Copy ${chainLabel(group.chains[0]!)} wallet address`
                                }
                              >
                                {copiedAddress === group.address ? (
                                  <Check className="size-4 text-success" aria-hidden />
                                ) : (
                                  <Copy className="size-4" aria-hidden />
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="border-t border-border/60 p-2">
                      <button
                        type="button"
                        data-testid="sign-out"
                        disabled={busy}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        onClick={() => void disconnectAuth()}
                      >
                        <LogOut
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="flex-1 text-left">Sign out</span>
                      </button>
                      <button
                        type="button"
                        disabled={!hasWallet}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={disconnectWallet}
                      >
                        <Wallet
                          className="size-3.5 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="flex-1 text-left">
                          Disconnect all wallets
                        </span>
                      </button>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
            {session === null ? (
              <div className="flex items-center gap-1.5">
                <div className="relative" ref={networkMenuRef}>
                  <button
                    type="button"
                    data-testid="network-menu"
                    aria-label="Network menu"
                    aria-expanded={networkMenuOpen}
                    aria-controls="signed-out-network-menu"
                    onClick={() => setNetworkMenuOpen((open) => !open)}
                    className={cn(
                      "radius-control flex min-h-8 items-center gap-1 bg-nav-hover px-2.5 text-[10px] font-semibold uppercase tracking-wide text-nav-foreground/80 transition-[background-color,color,box-shadow] duration-300 hover:bg-nav-active hover:text-nav-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav",
                      networkRingClass(mode),
                    )}
                  >
                    {mode === "mainnet" ? "Mainnet" : "Testnet"}
                    <ChevronDown className={cn("size-3 transition-transform", networkMenuOpen && "rotate-180")} aria-hidden />
                  </button>
                  {networkMenuOpen ? (
                    <section
                      id="signed-out-network-menu"
                      aria-label="Network menu"
                      className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-border/80 bg-card p-3 shadow-card"
                    >
                      <NetworkChoices
                        mode={mode}
                        confirmMainnet={confirmMainnet}
                        onSelect={switchNetwork}
                        onCancelMainnet={() => setConfirmMainnet(false)}
                      />
                    </section>
                  ) : null}
                </div>
                <motion.div whileTap={reduce ? undefined : buttonTap}>
                  <button
                    data-motion-button
                    data-testid="sign-in"
                    type="button"
                    onClick={() => setSignInOpen(true)}
                    className="radius-control cursor-pointer bg-brand px-3 py-1.5 text-sm font-semibold text-brand-foreground shadow-action transition-colors duration-100 ease-out hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-nav disabled:opacity-50"
                  >
                    Sign in
                  </button>
                </motion.div>
              </div>
            ) : null}
            {session === undefined ? (
              <span className="radius-control block size-8 animate-pulse bg-nav-hover" />
            ) : null}
          </div>
        </div>
      </header>
      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSignedIn={() => {
          void createClient()
            .auth.getSession()
            .then(({ data }) => setSession(data.session));
          void refreshMe();
        }}
      />
    </>
  );
}
