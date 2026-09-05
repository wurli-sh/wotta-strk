"use client";

import { ExternalLink, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatUsdc } from "@/lib/format/amount";
import { calculatePnl } from "@/lib/vesu/position";
import { EarnYieldChart } from "./EarnYieldChart";
import { PrivateTokenIcon } from "./PrivateTokenIcon";

function signedUsdc(value: bigint): string {
  return `${value >= 0n ? "+" : "−"}$${formatUsdc(value < 0n ? -value : value)}`;
}

function formatShares(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function EarnPositionHero(props: {
  assets: bigint;
  shares: bigint;
  costBasisAssets: bigint | null;
  firstDepositAt: string | null;
  apy: number | null;
  previousApy: number | null;
  utilization: number | null;
  marketPageUrl: string;
  onWithdraw: (percent: 25 | 50 | 100) => void;
  withdrawDisabled: boolean;
  disabledReason?: string;
}) {
  const pnl = calculatePnl(props.assets, props.costBasisAssets);
  const gain = (pnl?.assets ?? 0n) >= 0n;
  return (
    <section className="radius-surface border border-border/80 bg-card p-4 shadow-card sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <PrivateTokenIcon />
          <div>
            <h2 className="font-semibold text-foreground">Private earn</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Vesu Prime position
            </p>
          </div>
        </div>
        <span className="rounded-full bg-mainnet-soft px-2.5 py-1 text-xs font-semibold text-mainnet-ink">
          Active
        </span>
      </div>
      <p className="mt-7 text-xs text-muted-foreground">Position value</p>
      <div className="mt-2 flex items-center gap-2">
        <PrivateTokenIcon className="size-8" />
        <p className="font-mono text-4xl font-semibold tracking-tight tabular-nums text-foreground">
          {formatUsdc(props.assets)}
        </p>
      </div>
      {pnl ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="group relative inline-flex items-center gap-1 text-sm font-semibold text-foreground outline-none"
            tabIndex={0}
            aria-label={`Profit and loss since deposit ${props.firstDepositAt ? new Date(props.firstDepositAt).toLocaleDateString() : "on this device"}`}
          >
            {gain ? (
              <TrendingUp className="size-4 text-success" aria-hidden />
            ) : (
              <TrendingDown className="size-4 text-destructive" aria-hidden />
            )}
            {signedUsdc(pnl.assets)}
            <span
              className={
                gain
                  ? "rounded-full bg-success/10 px-2 py-0.5 text-success"
                  : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"
              }
            >
              {pnl.basisPoints >= 0n ? "+" : ""}
              {(Number(pnl.basisPoints) / 100).toFixed(2)}%
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white shadow-card group-hover:block group-focus:block"
            >
              Since deposit ·{" "}
              {props.firstDepositAt
                ? new Date(props.firstDepositAt).toLocaleDateString()
                : "this device"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            Local estimate on this device.
          </span>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Cost basis is unavailable on this device, so no P&amp;L estimate is
          shown.
        </p>
      )}
      <dl className="mt-5 border-t border-border/70 pt-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Private shares</dt>
          <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
            {formatShares(props.shares)}
          </dd>
        </div>
      </dl>
      <EarnYieldChart
        principal={props.assets}
        apy={props.apy}
        previousApy={props.previousApy}
        utilization={props.utilization}
      />
      <div className="mt-5 grid grid-cols-3 gap-2">
        {([25, 50, 100] as const).map((percent) => (
          <Button
            key={percent}
            variant={percent === 100 ? "brand" : "outline"}
            className="px-2"
            onClick={() => props.onWithdraw(percent)}
            disabled={props.withdrawDisabled}
          >
            {percent === 100 ? "Max" : `${percent}%`}
          </Button>
        ))}
      </div>
      <Button
        className="mt-2 w-full"
        variant="outline"
        href={props.marketPageUrl}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink className="size-4" aria-hidden /> View Vesu market
      </Button>
      {props.withdrawDisabled && props.disabledReason ? (
        <p className="mt-3 text-xs text-warning-foreground" role="status">
          {props.disabledReason}
        </p>
      ) : null}
    </section>
  );
}
