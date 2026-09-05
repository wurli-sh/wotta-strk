"use client";

import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatUsdc } from "@/lib/format/amount";
import { calculatePnl } from "@/lib/vesu/position";

function signedUsdc(value: bigint): string {
  return `${value >= 0n ? "+" : "−"}$${formatUsdc(value < 0n ? -value : value)}`;
}

export function EarnPositionHero(props: {
  assets: bigint;
  shares: bigint;
  costBasisAssets: bigint | null;
  firstDepositAt: string | null;
  apy: number | null;
  marketPageUrl: string;
  onWithdraw: (percent: 25 | 50 | 100) => void;
  withdrawDisabled: boolean;
  disabledReason?: string;
}) {
  const pnl = calculatePnl(props.assets, props.costBasisAssets);
  const gain = (pnl?.assets ?? 0n) >= 0n;
  return (
    <section className="radius-surface border border-border/80 bg-card p-5 shadow-card sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Private Vesu position</p>
      <p className="mt-2 text-4xl font-semibold tracking-tight text-foreground">${formatUsdc(props.assets)}</p>
      {pnl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="group relative inline-flex items-center gap-1 text-sm font-semibold text-foreground outline-none"
            tabIndex={0}
            aria-label={`Profit and loss since deposit ${props.firstDepositAt ? new Date(props.firstDepositAt).toLocaleDateString() : "on this device"}`}
          >
            {gain ? <TrendingUp className="size-4 text-success" aria-hidden /> : <TrendingDown className="size-4 text-destructive" aria-hidden />}
            {signedUsdc(pnl.assets)}
            <span className={gain ? "rounded-full bg-success/10 px-2 py-0.5 text-success" : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"}>
              {pnl.basisPoints >= 0n ? "+" : ""}{(Number(pnl.basisPoints) / 100).toFixed(2)}%
            </span>
            <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white shadow-card group-hover:block group-focus:block">
              Since deposit · {props.firstDepositAt ? new Date(props.firstDepositAt).toLocaleDateString() : "this device"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">Local estimate on this device.</span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Cost basis is unavailable on this device, so no P&amp;L estimate is shown.</p>
      )}
      <dl className="mt-5 grid gap-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Variable APY</dt><dd className="mt-1 font-semibold text-foreground">{props.apy === null ? "Unavailable" : `${props.apy.toFixed(2)}%`}</dd></div>
        <div><dt className="text-muted-foreground">Private vUSDC shares</dt><dd className="mt-1 break-all font-semibold text-foreground">{props.shares.toString()}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        {([25, 50, 100] as const).map((percent) => (
          <Button key={percent} onClick={() => props.onWithdraw(percent)} disabled={props.withdrawDisabled}>
            {percent === 100 ? "Withdraw max" : `Withdraw ${percent}%`}
          </Button>
        ))}
        <Button variant="outline" href={props.marketPageUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden /> Vesu market</Button>
      </div>
      {props.withdrawDisabled && props.disabledReason ? <p className="mt-3 text-xs text-warning-foreground" role="status">{props.disabledReason}</p> : null}
    </section>
  );
}
