"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  ShieldCheck,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { TOAST } from "@/lib/brand-copy";
import { userFacingError } from "@/lib/errors";
import { routeLogoPath } from "@/lib/crypto-icons";
import { createClient } from "@/lib/supabase/client";
import { AUTH_SESSION_EVENT } from "@/lib/auth";
import {
  unlockPrivacyVault,
  clearPrivacyVaultLocalState,
} from "@/lib/wotta/privacy-state";
import { privacyVaultUnlockConfig } from "@/lib/wotta/privacy-vault-config";
import { createBrowserProductSession } from "@/lib/wotta/product-session";
import { clearReadyConnections, connectReady } from "@/lib/wotta/ready";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { beginNetworkOperation } from "@/lib/network-operations";

type Props = {
  me: MeResponse | null;
  loading?: boolean;
  autoOpenConnect?: boolean;
  onLinked: (
    patch: Pick<MeResponse, "profile" | "identities" | "wallet">,
  ) => void | Promise<void>;
};

export function WalletAndBalancePanel({
  me,
  loading,
  autoOpenConnect = false,
  onLinked,
}: Props) {
  const { mode } = useNetworkMode();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(autoOpenConnect);

  const wallet = me?.wallet?.address ?? null;

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success(TOAST.addressCopied);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(TOAST.addressCopyFailed);
    }
  }

  async function unlinkWallet() {
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    try {
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in first");
      await apiFetch("/v1/wallet/unlink", {
        token,
        method: "POST",
        body: {},
        network: mode,
        signal: operation.signal,
      });
      clearReadyConnections();
      if (wallet) {
        const { poolAddress } = privacyVaultUnlockConfig(mode);
        clearPrivacyVaultLocalState(wallet, poolAddress);
      }
      toast.success(TOAST.readyUnlinked);
      await onLinked({
        profile: me?.profile ?? null,
        identities: me?.identities ?? [],
        wallet: null,
      });
    } catch (e) {
      toast.error(userFacingError(e, TOAST.unlinkWalletFailed));
    } finally {
      operation.finish();
      setBusy(false);
    }
  }

  async function upgradeInboxKey() {
    if (!me?.wallet) {
      toast.error(TOAST.linkReadyToReveal);
      return;
    }
    const confirmed = window.confirm(
      "Upgrade to a wallet-backed inbox key?\n\nNew payments will use the new key. Existing claimable notes sealed to the old key stay claimable only on browsers that still hold that key (Inbox shows “Older inbox key”).",
    );
    if (!confirmed) return;
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    try {
      const connected = await connectReady(mode);
      operation.assertActive();
      if (BigInt(connected.address) !== BigInt(me.wallet.address)) {
        throw new Error(
          "Connect the Ready account linked to this Wotta profile",
        );
      }
      const vault = await unlockPrivacyVault(
        connected.account,
        privacyVaultUnlockConfig(mode),
      );
      const session = createBrowserProductSession();
      await session.bindReadyAndIdentity(connected.account, vault, undefined, {
        rotateInboxKey: true,
      });
      const linkedMe = await session.me();
      window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
      toast.success(TOAST.inboxKeyUpgraded);
      await onLinked({
        profile: linkedMe.profile ?? me.profile ?? null,
        identities: linkedMe.identities ?? me.identities ?? [],
        wallet: linkedMe.wallet
          ? {
              address: linkedMe.wallet.address,
              inbox_pubkey: linkedMe.wallet.inbox_pubkey,
              chain_id:
                linkedMe.wallet.chain_id ??
                me.wallet.chain_id ??
                (mode === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA"),
              key_version:
                linkedMe.wallet.key_version ?? me.wallet.key_version ?? 1,
              inbox_key_scheme:
                linkedMe.wallet.inbox_key_scheme ?? "ready_derived_v1",
              private_identity_address:
                linkedMe.wallet.private_identity_address ??
                me.wallet.private_identity_address,
              privacy_pool_address:
                linkedMe.wallet.privacy_pool_address ??
                me.wallet.privacy_pool_address,
              private_identity_verified_at:
                me.wallet.private_identity_verified_at ??
                new Date().toISOString(),
            }
          : null,
      });
    } catch (e) {
      toast.error(userFacingError(e, "Couldn’t upgrade inbox key"));
    } finally {
      operation.finish();
      setBusy(false);
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
            <h2 className="text-sm font-semibold text-foreground">
              {mode === "mainnet" ? "Mainnet wallet" : "Wallet"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "mainnet"
                ? "Your Ready mainnet account receives private claims. Real funds and STRK fees apply."
                : "Your Ready address receives private claims. Private USDC notes stay under your identity."}
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void copyAddress(wallet)}
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden />
                  )}
                  {copied ? "Copied" : "Copy address"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(true)}
                >
                  Reconnect
                </Button>
                {me?.wallet?.inbox_key_scheme !== "ready_derived_v1" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    data-testid="upgrade-inbox-key"
                    onClick={() => void upgradeInboxKey()}
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden />
                    {busy ? "Upgrading…" : "Upgrade inbox key"}
                  </Button>
                ) : null}
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
              {mode === "mainnet" &&
              !me?.wallet?.private_identity_verified_at ? (
                <div
                  className="radius-surface-inner border border-warning-border bg-warning-surface px-4 py-3 text-xs leading-5 text-warning-foreground"
                  role="status"
                >
                  Wallet linked; private pool setup is not finished. Open Ready
                  → gear → your account → Enable private tokens, tap Enable,
                  then return to Send. Wotta shields the selected amount
                  automatically.
                </div>
              ) : null}
            </div>
          ) : (
            <div>
              <p
                data-testid="active-wallet"
                className="radius-surface-inner border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
              >
                No Ready claim wallet linked
              </p>
              <Button
                className="mt-3 w-full"
                data-testid="bind-wallet"
                onClick={() => setModalOpen(true)}
              >
                <ShieldCheck className="size-4" aria-hidden />
                Connect Ready wallet
              </Button>
            </div>
          )}
        </div>
      </section>

      <WalletConnectModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        reconnect={Boolean(wallet)}
        linkedWalletAddress={wallet}
        onLinked={async (linkedMe) => {
          await onLinked({
            profile: linkedMe.profile ?? me?.profile ?? null,
            identities: linkedMe.identities ?? me?.identities ?? [],
            wallet: linkedMe.wallet
              ? {
                  address: linkedMe.wallet.address,
                  inbox_pubkey: linkedMe.wallet.inbox_pubkey,
                  chain_id:
                    (linkedMe.wallet as { chain_id?: string }).chain_id ??
                    (mode === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA"),
                  key_version:
                    linkedMe.wallet.key_version ?? me?.wallet?.key_version ?? 1,
                  inbox_key_scheme:
                    linkedMe.wallet.inbox_key_scheme ?? "ready_derived_v1",
                  private_identity_address:
                    linkedMe.wallet.private_identity_address ??
                    me?.wallet?.private_identity_address,
                  privacy_pool_address:
                    linkedMe.wallet.privacy_pool_address ??
                    me?.wallet?.privacy_pool_address,
                  private_identity_verified_at:
                    me?.wallet?.private_identity_verified_at ??
                    new Date().toISOString(),
                }
              : null,
          });
        }}
      />
    </>
  );
}
