"use client";

import { useState } from "react";
import { Check, Copy, ShieldCheck, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { WalletPanelSkeleton } from "@/components/ui/Skeleton";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { routeLogoPath } from "@/lib/crypto-icons";
import { createClient } from "@/lib/supabase/client";

type Props = {
  me: MeResponse | null;
  loading?: boolean;
  /** Open connect modal on mount (e.g. register redirect). */
  autoOpenConnect?: boolean;
  onLinked: (patch: Pick<MeResponse, "profile" | "identities" | "wallet">) => void | Promise<void>;
};

export function WalletPanel({
  me,
  loading,
  autoOpenConnect = false,
  onLinked,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(autoOpenConnect);
  const wallet = me?.wallet?.address ?? null;

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn’t copy address");
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
      toast.error(userFacingError(e, "Couldn’t unlink wallet"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <WalletPanelSkeleton />;

  return (
    <>
      <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
        <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Wallets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Your Ready address receives private claims. Wotta never creates
              or controls it.
            </p>
          </div>
        </div>
        <div className="space-y-4 p-5 sm:p-6">
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
