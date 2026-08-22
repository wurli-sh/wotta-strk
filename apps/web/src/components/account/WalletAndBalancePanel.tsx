"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, LockKeyhole, RefreshCw, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { routeLogoPath } from "@/lib/crypto-icons";
import { createClient } from "@/lib/supabase/client";
import { createPrivacyClient } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { privateBalance } from "@/lib/wotta/privacy-flow";
import { unlockPrivacyVault } from "@/lib/wotta/privacy-state";
import { connectReady } from "@/lib/wotta/ready";

type Props = {
  me: MeResponse | null;
  loading?: boolean;
  autoOpenConnect?: boolean;
  /** When set, “Reveal balance” navigates instead of unlocking inline. */
  revealHref?: string;
  onLinked: (patch: Pick<MeResponse, "profile" | "identities" | "wallet">) => void | Promise<void>;
};

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function WalletAndBalancePanel({
  me,
  loading,
  autoOpenConnect = false,
  revealHref,
  onLinked,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(autoOpenConnect);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);

  const wallet = me?.wallet?.address ?? null;

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy address");
    }
  }

  async function unlinkWallet() {
    setBusy(true);
    try {
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in first");
      await apiFetch("/v1/wallet/unlink", {
        token,
        method: "POST",
        body: {},
      });
      toast.success("Ready wallet unlinked");
      await onLinked({
        profile: me?.profile ?? null,
        identities: me?.identities ?? [],
        wallet: null,
      });
    } catch (e) {
      toast.error(userFacingError(e, "Couldn't unlink wallet"));
    } finally {
      setBusy(false);
    }
  }

  async function revealBalance() {
    if (!me?.wallet) {
      toast.error("Link Ready to reveal your private balance");
      return;
    }
    setBalanceBusy(true);
    try {
      const connected = await connectReady();
      if (BigInt(connected.address) !== BigInt(me.wallet.address)) {
        throw new Error("Connect the Ready account linked to this Wotta profile");
      }
      const config = directPrivacyConfig();
      const vault = await unlockPrivacyVault(connected.account, config);
      const identityAddress = vault.state.identityAddress ?? me.wallet.private_identity_address;
      if (!identityAddress) throw new Error("Register your private identity first");
      const transfers = createPrivacyClient(identityAddress, BigInt(vault.state.viewingKey), config);
      setBalance(await privateBalance(transfers, config.usdc));
      setRevealed(true);
      setUpdatedAt(new Date());
    } catch (error) {
      toast.error(userFacingError(error, "Could not reveal your private balance"));
    } finally {
      setBalanceBusy(false);
    }
  }

  if (loading) {
    return (
      <section
        className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card"
        role="status"
        aria-busy="true"
        aria-label="Loading wallet"
      >
        <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
          <Skeleton className="size-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3.5 w-full max-w-[16rem]" />
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="radius-surface-inner flex items-center gap-3 border border-brand-muted/40 bg-brand-mist/60 px-4 py-3">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="radius-control h-9 w-28" />
            <Skeleton className="radius-control h-9 w-24" />
          </div>
          <div className="border-t border-border/70 pt-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-10 w-32" />
            <Skeleton className="mt-3 h-3 w-44 max-w-full" />
            <Skeleton className="radius-control mt-4 h-10 w-36" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
        <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Wallet & private balance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your Ready address receives private claims. Private USDC notes stay under your identity.
            </p>
          </div>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {wallet ? (
            <div className="space-y-3">
              <div className="radius-surface-inner flex items-center gap-3 border border-brand-muted/70 bg-brand-mist px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routeLogoPath("starknet")}
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 shrink-0"
                />
                <p
                  data-testid="active-wallet"
                  className="min-w-0 flex-1 break-all font-sans text-sm leading-relaxed text-brand-ink"
                >
                  {wallet}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void copyAddress(wallet)}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? "Copied" : "Copy address"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setModalOpen(true)}>
                  Reconnect
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  data-testid="unlink-wallet"
                  onClick={() => void unlinkWallet()}
                >
                  <Unlink className="h-3.5 w-3.5" aria-hidden />
                  {busy ? "Unlinking…" : "Unlink"}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <p
                data-testid="active-wallet"
                className="radius-surface-inner border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
              >
                No Ready claim wallet linked
              </p>
              <Button className="mt-3 w-full" data-testid="bind-wallet" onClick={() => setModalOpen(true)}>
                <ShieldCheck className="size-4" aria-hidden />
                Connect Ready wallet
              </Button>
            </div>
          )}

          <div className="border-t border-border/70 pt-5">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-muted bg-brand-soft text-brand-ink">
                <LockKeyhole className="size-3.5" aria-hidden />
              </span>
              <p className="text-xs font-medium uppercase tracking-wide text-brand-ink/75">Private USDC</p>
            </div>
            <div className="radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6">
              <p className="mt-0 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {revealed && balance !== null ? formatUsdc(balance) : "••••••"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {updatedAt
                  ? `Last revealed ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : "Reveal requires Ready authorization."}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {revealHref ? (
                <Button href={revealHref}>
                  <Eye className="size-4" aria-hidden />
                  Reveal balance
                </Button>
              ) : (
                <Button disabled={balanceBusy} aria-disabled={balanceBusy} onClick={() => void revealBalance()}>
                  {balanceBusy || revealed ? (
                    <RefreshCw className={`size-4 ${balanceBusy ? "animate-spin" : ""}`} aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                  {balanceBusy ? "Revealing…" : revealed ? "Refresh balance" : "Reveal balance"}
                </Button>
              )}
              {!revealHref && revealed ? (
                <Button variant="secondary" onClick={() => setRevealed(false)}>
                  <EyeOff className="size-4" aria-hidden />
                  Hide
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <WalletConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onLinked={async (linkedMe) => {
          await onLinked({
            profile: linkedMe.profile ?? me?.profile ?? null,
            identities: linkedMe.identities ?? me?.identities ?? [],
            wallet: linkedMe.wallet
              ? {
                  address: linkedMe.wallet.address,
                  inbox_pubkey: linkedMe.wallet.inbox_pubkey,
                  chain_id: me?.wallet?.chain_id ?? "SN_SEPOLIA",
                  key_version: me?.wallet?.key_version ?? 1,
                  private_identity_address:
                    linkedMe.wallet.private_identity_address ?? me?.wallet?.private_identity_address,
                  privacy_pool_address:
                    linkedMe.wallet.privacy_pool_address ?? me?.wallet?.privacy_pool_address,
                  private_identity_verified_at:
                    me?.wallet?.private_identity_verified_at ?? new Date().toISOString(),
                }
              : null,
          });
        }}
      />
    </>
  );
}
