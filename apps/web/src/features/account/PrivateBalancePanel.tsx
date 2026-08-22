"use client";

import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import type { MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { createPrivacyClient } from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { privateBalance } from "@/lib/wotta/privacy-flow";
import { unlockPrivacyVault } from "@/lib/wotta/privacy-state";
import { connectReady } from "@/lib/wotta/ready";

type Props = { wallet: MeResponse["wallet"]; loading?: boolean };

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function PrivateBalancePanel({ wallet, loading }: Props) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  async function revealBalance() {
    if (!wallet) {
      toast.error("Link Ready to reveal your private balance");
      return;
    }
    setBusy(true);
    try {
      const connected = await connectReady();
      if (BigInt(connected.address) !== BigInt(wallet.address)) {
        throw new Error("Connect the Ready account linked to this Wotta profile");
      }
      const config = directPrivacyConfig();
      const vault = await unlockPrivacyVault(connected.account, config);
      const identityAddress = vault.state.identityAddress ?? wallet.private_identity_address;
      if (!identityAddress) throw new Error("Register your private identity first");
      const transfers = createPrivacyClient(identityAddress, BigInt(vault.state.viewingKey), config);
      setBalance(await privateBalance(transfers, config.usdc));
      setRevealed(true);
      setUpdatedAt(new Date());
    } catch (error) {
      toast.error(userFacingError(error, "Could not reveal your private balance"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
          <LockKeyhole className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Private balance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Private USDC notes controlled by your Ready identity.</p>
        </div>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {loading ? (
          <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading balance">
            <div className="radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-10 w-32" />
              <Skeleton className="mt-3 h-3 w-44 max-w-full" />
            </div>
            <div className="flex gap-2"><Skeleton className="radius-control h-10 w-36" /><Skeleton className="radius-control h-10 w-20" /></div>
          </div>
        ) : (
          <>
            <div className="radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-ink/75">Private USDC</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {revealed && balance !== null ? formatUsdc(balance) : "••••••"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {updatedAt ? `Last revealed ${updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Reveal requires Ready authorization."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} aria-disabled={busy} onClick={() => void revealBalance()}>
                {busy || revealed ? <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden /> : <Eye className="size-4" aria-hidden />}
                {busy ? "Revealing…" : revealed ? "Refresh balance" : "Reveal balance"}
              </Button>
              {revealed ? <Button variant="secondary" onClick={() => setRevealed(false)}><EyeOff className="size-4" aria-hidden />Hide</Button> : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">The viewing key remains encrypted locally; Wotta only sees public pool metadata.</p>
          </>
        )}
      </div>
    </section>
  );
}
