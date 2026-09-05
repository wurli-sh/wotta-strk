"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LockKeyhole, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { MeResponse } from "@/lib/api/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { Button } from "@/components/ui/Button";
import { EarnPositionHero } from "./EarnPositionHero";
import { beginNetworkOperation } from "@/lib/network-operations";
import { userFacingError } from "@/lib/errors";
import { formatUsdc } from "@/lib/format/amount";
import { connectReady } from "@/lib/wotta/ready";
import { readMainnetPrivateBalance, readMainnetPrivateTokenBalance, submitMainnetStrk20Actions } from "@/lib/wotta/mainnet-privacy";
import { buildVesuDepositActions, buildVesuRedeemActions } from "@/lib/vesu/actions";
import { canDeposit, canWithdraw, earnUnavailableReason, loadVesuEarn, sameFelt } from "@/lib/vesu/config";
import { fetchVesuMarket, type VesuMarketStats } from "@/lib/vesu/market";
import { readVesuPosition } from "@/lib/vesu/position";
import { readLedger, recordDeposit, recordRedeem } from "@/lib/vesu/ledger";
import { assertVesuRuntime } from "@/lib/vesu/runtime";

const AMOUNTS = [100_000n, 1_000_000n] as const;

function parseAllowedUsdc(value: string): bigint {
  if (value.trim() === "0.1") return 100_000n;
  if (value.trim() === "1" || value.trim() === "1.0") return 1_000_000n;
  return 0n;
}

export function EarnPanel({ me }: { me: MeResponse | null }) {
  const { mode } = useNetworkMode();
  const config = loadVesuEarn();
  const linkedAddress = me?.wallet?.address ?? null;
  const [readyAddress, setReadyAddress] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [assets, setAssets] = useState<bigint | null>(null);
  const [amount, setAmount] = useState<bigint>(AMOUNTS[0]);
  const [amountText, setAmountText] = useState("0.1");
  const [market, setMarket] = useState<VesuMarketStats | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ledgerRevision, setLedgerRevision] = useState(0);

  useEffect(() => {
    let active = true;
    if (mode !== "mainnet") return;
    void fetchVesuMarket().then((value) => { if (active) { setMarket(value); setMarketError(false); } }).catch(() => { if (active) setMarketError(true); });
    return () => { active = false; };
  }, [mode]);

  async function refresh() {
    if (mode !== "mainnet" || !linkedAddress) return;
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    setBusy(true);
    try {
      const connected = await connectReady("mainnet");
      operation.assertActive();
      if (!sameFelt(connected.address, linkedAddress)) throw new Error("Connect the Ready account linked to this Wotta profile");
      const [privateUsdc, position] = await Promise.all([
        readMainnetPrivateBalance(connected.account),
        readVesuPosition(connected.account),
      ]);
      operation.assertActive();
      setReadyAddress(connected.address);
      setUsdc(privateUsdc);
      setShares(position.shares);
      setAssets(position.assets);
    } catch (error) {
      toast.error(userFacingError(error, "Could not load your private Vesu position"));
    } finally {
      operation.finish();
      setBusy(false);
    }
  }

  async function deposit() {
    if (!readyAddress || usdc === null || amount > usdc || !canDeposit({ mode, readyAddress, linkedAddress, amount }, config)) return;
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    setBusy(true);
    try {
      const connected = await connectReady("mainnet");
      if (!sameFelt(connected.address, linkedAddress)) throw new Error("Connect the Ready account linked to this Wotta profile");
      await assertVesuRuntime(connected.account);
      const hash = await submitMainnetStrk20Actions(connected.account, buildVesuDepositActions(connected.address, amount), operation.signal);
      recordDeposit(connected.address, config.vTokenAddress, amount);
      toast.success("Private USDC supplied to Vesu", { action: { label: "Explorer", onClick: () => window.open(`https://starkscan.co/tx/${hash}?network=mainnet`, "_blank") } });
      window.dispatchEvent(new CustomEvent("wotta:private-balance-invalidate"));
      setLedgerRevision((value) => value + 1);
      await refresh();
    } catch (error) { toast.error(userFacingError(error, "Could not start earning")); }
    finally { operation.finish(); setBusy(false); }
  }

  async function withdraw(percent: 25 | 50 | 100) {
    if (!readyAddress || shares === null || !canWithdraw({ mode, readyAddress, linkedAddress, privateShares: shares }, config)) return;
    const operation = beginNetworkOperation(mode, { blocksNetworkSwitch: true });
    setBusy(true);
    try {
      const connected = await connectReady("mainnet");
      if (!sameFelt(connected.address, linkedAddress)) throw new Error("Connect the Ready account linked to this Wotta profile");
      await assertVesuRuntime(connected.account);
      const freshShares = await readMainnetPrivateTokenBalance(connected.account, config.vTokenAddress);
      const redeemShares = percent === 100 ? freshShares : (freshShares * BigInt(percent)) / 100n;
      if (redeemShares <= 0n) throw new Error("No private vUSDC is available to withdraw");
      const hash = await submitMainnetStrk20Actions(connected.account, buildVesuRedeemActions(connected.address, redeemShares, freshShares), operation.signal);
      recordRedeem(connected.address, config.vTokenAddress, freshShares, freshShares - redeemShares);
      toast.success("Private vUSDC redeemed to private USDC", { action: { label: "Explorer", onClick: () => window.open(`https://starkscan.co/tx/${hash}?network=mainnet`, "_blank") } });
      window.dispatchEvent(new CustomEvent("wotta:private-balance-invalidate"));
      setLedgerRevision((value) => value + 1);
      await refresh();
    } catch (error) { toast.error(userFacingError(error, "Could not withdraw from Vesu")); }
    finally { operation.finish(); setBusy(false); }
  }

  if (mode !== "mainnet") return <Unavailable icon={<ShieldAlert className="size-5" />} text={earnUnavailableReason(mode, config)} />;
  if (!linkedAddress) return <Unavailable icon={<LockKeyhole className="size-5" />} text="Link a Ready Mainnet wallet from the Wallet tab before using Earn." />;

  const ledger = readyAddress ? readLedger(readyAddress, config.vTokenAddress) : null;
  void ledgerRevision;
  if (shares !== null && assets !== null && shares > 0n) {
    const withdrawAllowed = canWithdraw({ mode, readyAddress, linkedAddress, privateShares: shares }, config);
    return <EarnPositionHero assets={assets} shares={shares} costBasisAssets={ledger ? BigInt(ledger.costBasisAssets) : null} firstDepositAt={ledger?.firstDepositAt ?? null} apy={market?.supplyApy ?? null} marketPageUrl={config.marketPageUrl} onWithdraw={(percent) => void withdraw(percent)} withdrawDisabled={busy || !withdrawAllowed} disabledReason={!withdrawAllowed ? earnUnavailableReason(mode, config) : undefined} />;
  }

  const admitted = canDeposit({ mode, readyAddress, linkedAddress, amount }, config)
    && usdc !== null
    && amount <= usdc;
  const gateMessage = config.status === "pending" || config.status === "withdraw_only" || !readyAddress
    ? earnUnavailableReason(mode, config)
    : amount === 0n
      ? "Enter one of the beta amounts: 0.1 or 1 USDC."
      : usdc !== null && amount > usdc
        ? "Your private USDC balance is lower than this amount."
        : earnUnavailableReason(mode, config);
  return (
    <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
      <div className="border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
        <div className="flex items-start gap-3"><span className="flex size-9 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink"><Sparkles className="size-4" /></span><div><h2 className="text-sm font-semibold text-foreground">Earn with private USDC</h2><p className="mt-1 text-sm text-muted-foreground">Supply to Vesu Prime and receive private vUSDC shares. The rate is variable.</p></div></div>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2"><div className="radius-surface-inner border border-border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">Private USDC</p><p className="mt-1 text-2xl font-semibold">{usdc === null ? "Hidden" : `$${formatUsdc(usdc)}`}</p></div><div className="radius-surface-inner border border-border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">Variable APY</p><p className="mt-1 text-2xl font-semibold">{market ? `${market.supplyApy.toFixed(2)}%` : "Unavailable"}</p></div></div>
        {marketError ? <p className="text-xs text-warning-foreground">Live Vesu stats are unavailable. Transaction admission never depends on this API.</p> : null}
        <div>
          <label htmlFor="vesu-deposit-amount" className="mb-2 block text-sm font-medium">Amount</label>
          <div className="relative max-w-sm"><input id="vesu-deposit-amount" inputMode="decimal" value={amountText} onChange={(event) => { setAmountText(event.target.value); setAmount(parseAllowedUsdc(event.target.value)); }} aria-describedby="vesu-amount-help" className="radius-control min-h-11 w-full border border-border bg-card px-4 pr-16 text-base text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30" /><span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs font-semibold text-muted-foreground">USDC</span></div>
          <div className="mt-2 flex gap-2">{AMOUNTS.map((value) => <Button key={value.toString()} size="sm" variant={amount === value ? "secondary" : "outline"} onClick={() => { setAmount(value); setAmountText(formatUsdc(value)); }}>{formatUsdc(value)}</Button>)}</div>
          <p id="vesu-amount-help" className="mt-2 text-xs text-muted-foreground">Mainnet beta accepts exactly 0.1 or 1 USDC.</p>
        </div>
        {!admitted ? <div className="radius-surface-inner border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-foreground" role="status">{gateMessage}</div> : null}
        <div className="flex flex-wrap gap-2"><Button onClick={readyAddress ? () => void deposit() : () => void refresh()} disabled={busy || (readyAddress !== null && !admitted)}>{busy ? "Checking Ready…" : readyAddress ? "Start earning" : "View private balance"}</Button><Button variant="outline" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-4" /> Refresh</Button><Button variant="outline" href={config.marketPageUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> Market</Button></div>
        <p className="text-xs leading-5 text-muted-foreground">Your resulting vUSDC remains shielded. The Vesu market, action, amount, and timing are visible onchain.</p>
      </div>
    </section>
  );
}

function Unavailable({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <section className="radius-surface border border-border/80 bg-card p-6 text-center shadow-card"><span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">{icon}</span><h2 className="mt-4 font-semibold text-foreground">Vesu Earn unavailable</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{text}</p></section>;
}
