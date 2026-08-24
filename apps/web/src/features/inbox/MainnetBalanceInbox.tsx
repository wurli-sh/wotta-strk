"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ExternalLink, LockKeyhole, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { fetchMe } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { starkscanTransactionUrl } from "@/lib/network-mode";
import { beginNetworkOperation } from "@/lib/network-operations";
import { connectReady } from "@/lib/wotta/ready";
import { MAINNET_USDC_PRIVACY_FEE_RESERVE, mainnetPrivacyConfig, readMainnetPrivateBalance, readMainnetPublicStrkBalance, submitMainnetPrivacyAction } from "@/lib/wotta/mainnet-privacy";
import { readMainnetEvidence, recordMainnetEvidence, type MainnetEvidence } from "@/lib/wotta/mainnet-evidence";

function formatUsdc(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function MainnetBalanceInbox() {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<MainnetEvidence[]>([]);
  const [feeBalance, setFeeBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const config = mainnetPrivacyConfig();
  const withdrawalAmount = config.amount;
  const withdrawalRequiredBalance = withdrawalAmount + MAINNET_USDC_PRIVACY_FEE_RESERVE;

  useEffect(() => setEvidence(readMainnetEvidence()), []);

  async function connectAndVerify() {
    const me = await fetchMe();
    if (!me.ok || !me.data.wallet || me.data.wallet.chain_id !== "SN_MAIN") {
      throw new Error("Link your Ready mainnet wallet from Account first");
    }
    const connected = await connectReady("mainnet");
    if (BigInt(connected.address) !== BigInt(me.data.wallet.address)) {
      throw new Error("Connect the Ready mainnet account linked to this Wotta profile");
    }
    setWalletAddress(connected.address);
    return connected;
  }

  async function refresh() {
    const operation = beginNetworkOperation("mainnet", { blocksNetworkSwitch: true });
    setBusy(true);
    setError(null);
    try {
      const connected = await connectAndVerify();
      operation.assertActive();
      const [privateBalance, strkBalance] = await Promise.all([
        readMainnetPrivateBalance(connected.account),
        readMainnetPublicStrkBalance(connected.account),
      ]);
      operation.assertActive();
      setBalance(privateBalance);
      setFeeBalance(strkBalance);
      setEvidence(readMainnetEvidence());
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = userFacingError(error, "Couldn’t load mainnet private balance");
        setError(message);
        toast.error(message);
      }
    } finally {
      operation.finish();
      setBusy(false);
    }
  }

  async function withdraw() {
    const operation = beginNetworkOperation("mainnet", { blocksNetworkSwitch: true });
    setBusy(true);
    setError(null);
    try {
      const connected = await connectAndVerify();
      operation.assertActive();
      const [current, strkBalance] = await Promise.all([
        readMainnetPrivateBalance(connected.account),
        readMainnetPublicStrkBalance(connected.account),
      ]);
      operation.assertActive();
      setFeeBalance(strkBalance);
      if (current < withdrawalRequiredBalance) {
        throw new Error(`You need at least ${formatUsdc(withdrawalRequiredBalance)} private USDC to withdraw ${formatUsdc(withdrawalAmount)} and cover Ready’s privacy fee reserve`);
      }
      if (strkBalance < config.protocolFeeStrk) throw new Error("Need at least 6 STRK plus network gas in this Ready mainnet account");
      const hash = await submitMainnetPrivacyAction(connected.account, "withdraw", connected.address, operation.signal);
      operation.assertActive();
      recordMainnetEvidence("withdraw", hash);
      setEvidence(readMainnetEvidence());
      setBalance(await readMainnetPrivateBalance(connected.account));
      toast.success(`${formatUsdc(withdrawalAmount)} USDC withdrawn to your public Ready balance`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        const message = userFacingError(error, "Couldn’t withdraw on mainnet");
        setError(message);
        toast.error(message);
      }
    } finally {
      operation.finish();
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
        <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
            <LockKeyhole className="size-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Live-pool private balance</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ready discovers your mainnet private notes locally. Wotta does not receive your viewing key.</p>
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-ink/75">Private mainnet USDC</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {balance === null ? "••••••" : formatUsdc(balance)}
            </p>
            <p className="mt-2 break-all text-xs text-muted-foreground">{walletAddress ?? "Connect Ready to reveal"}</p>
            {feeBalance !== null ? <p className="mt-1 text-xs text-muted-foreground">Fee balance {(Number(feeBalance) / 1e18).toFixed(2)} STRK</p> : null}
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-destructive">Couldn’t complete the Mainnet action</p>
                <p className="mt-1 text-xs leading-5 text-foreground">{error}</p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} aria-hidden /> Refresh balance
            </Button>
            <Button className="w-full" disabled={busy || balance === null || balance < withdrawalRequiredBalance} onClick={() => void withdraw()}>
              <Wallet className="size-4" aria-hidden /> Withdraw {formatUsdc(withdrawalAmount)} USDC
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">Withdrawal sends {formatUsdc(withdrawalAmount)} USDC to this Ready account’s public mainnet balance. Keep at least {formatUsdc(MAINNET_USDC_PRIVACY_FEE_RESERVE)} additional private USDC for Ready’s privacy fee; Starknet gas also applies.</p>
        </div>
      </section>

      {evidence.length ? (
        <section className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
          <div className="border-b border-border/60 px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">This browser’s mainnet activity</h2>
          </div>
          <ul className="divide-y divide-border/50">
            {evidence.map((item) => (
              <li key={item.transactionHash} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize text-foreground">{item.action}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">{item.transactionHash}</p>
                </div>
                <Button size="sm" variant="secondary" href={starkscanTransactionUrl("mainnet", item.transactionHash)} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden /> Explorer
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
