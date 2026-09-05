"use client";

import { useId, useMemo, useState } from "react";
import { ApyMovement } from "./ApyMovement";

type Period = "1m" | "6m" | "1y";

const PERIODS: Array<{ value: Period; label: string; months: number }> = [
  { value: "1m", label: "1M", months: 1 },
  { value: "6m", label: "6M", months: 6 },
  { value: "1y", label: "1Y", months: 12 },
];

function projectedValue(
  principal: bigint,
  apy: number,
  months: number,
): number {
  const dollars = Number(principal) / 1_000_000;
  return dollars * Math.pow(1 + apy / 100, months / 12);
}

export function EarnYieldChart({
  principal,
  apy,
  previousApy = null,
  utilization = null,
  compact = false,
}: {
  principal: bigint;
  apy: number | null;
  previousApy?: number | null;
  utilization?: number | null;
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("1y");
  const gradientId = useId().replaceAll(":", "");
  const selected = PERIODS.find((item) => item.value === period)!;
  const points = useMemo(() => {
    if (apy === null || principal <= 0n) return [];
    return Array.from({ length: 13 }, (_, index) =>
      projectedValue(principal, apy, (selected.months * index) / 12),
    );
  }, [apy, principal, selected.months]);
  const end = points.at(-1) ?? 0;
  const start = points[0] ?? 0;
  const range = Math.max(end - start, Math.max(start * 0.002, 0.0001));
  const coords = points.map((value, index) => ({
    x: 16 + (568 * index) / Math.max(points.length - 1, 1),
    y: (compact ? 88 : 150) - ((value - start) / range) * (compact ? 60 : 112),
  }));
  const baseline = compact ? 94 : 158;
  const line = coords
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
    )
    .join(" ");
  const area = coords.length
    ? `${line} L584,${baseline} L16,${baseline} Z`
    : "";

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Supply APY</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {apy === null ? "—" : `${apy.toFixed(2)}%`}
            </p>
            <ApyMovement
              apy={apy}
              previousApy={previousApy}
              utilization={utilization}
            />
          </div>
          <div
            className="flex rounded-full bg-muted p-0.5"
            aria-label="Projection period"
          >
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPeriod(item.value)}
                aria-pressed={period === item.value}
                className="min-h-10 min-w-10 rounded-full px-2 text-xs font-semibold text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-100 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-soft"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {points.length ? (
          <div
            className="mt-2 text-brand"
            role="img"
            aria-label={`Projected balance after ${selected.label}: ${end.toFixed(2)} USDC`}
          >
            <svg
              viewBox="0 0 600 104"
              className="h-16 w-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="currentColor"
                    stopOpacity="0.18"
                  />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gradientId})`} />
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <p className="-mt-1 text-right font-mono text-xs tabular-nums text-muted-foreground">
              ≈ ${end.toFixed(2)}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Projection unavailable.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-y border-border/70 py-4">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Supply APY</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {apy === null ? "—" : `${apy.toFixed(2)}%`}
          </p>
          <ApyMovement
            apy={apy}
            previousApy={previousApy}
            utilization={utilization}
          />
        </div>
        <div
          className="flex rounded-full bg-muted p-1"
          aria-label="Projection period"
        >
          {PERIODS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setPeriod(item.value)}
              aria-pressed={period === item.value}
              className="min-h-10 min-w-10 rounded-full px-2 text-xs font-semibold text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-100 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-soft"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {points.length ? (
        <div
          className="mt-3 text-brand"
          role="img"
          aria-label={`Projected balance after ${selected.label}: ${end.toFixed(2)} USDC at a variable ${apy?.toFixed(2)} percent APY`}
        >
          <svg
            viewBox="0 0 600 176"
            className="h-36 w-full overflow-visible"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line
              x1="16"
              y1="158"
              x2="584"
              y2="158"
              className="stroke-border"
              strokeWidth="1"
            />
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={coords.at(-1)?.x}
              cy={coords.at(-1)?.y}
              r="4"
              fill="currentColor"
            />
          </svg>
          <div className="-mt-2 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Now</span>
            <span className="font-mono tabular-nums">≈ ${end.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex h-36 items-center justify-center rounded-2xl bg-muted/60 text-xs text-muted-foreground">
          Enter an amount to preview growth.
        </div>
      )}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Projection only. APY changes with the market and returns are not
        guaranteed.
      </p>
    </div>
  );
}
