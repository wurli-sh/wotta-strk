"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { UsdcIcon } from "@/components/UsdcIcon";

type Props = {
  label?: string;
  amount: string;
  assetLabel?: string;
  recipient?: string;
  note?: string;
  status?: string;
  className?: string;
  compact?: boolean;
  /** When false, omit e2e claim-ready marker (demo / marketing). */
  interactive?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
};

/**
 * Swoop-style private note card — visa-ratio shell,
 * brand face, amount hero, optional white footer actions.
 */
export function NoteVisaCard({
  label = "Private note",
  amount,
  assetLabel = "USDC",
  recipient,
  note,
  status = "ready to claim",
  className,
  compact = false,
  interactive = true,
  children,
  footer,
}: Props) {
  return (
    <div
      className={cn(
        "relative z-0 mx-auto w-full max-w-[420px]",
        className,
      )}
      data-testid={interactive ? "fragment-ready" : undefined}
    >
      <div
        className={cn(
          "radius-surface overflow-hidden border border-border/70 bg-card shadow-card",
          footer ? "p-2" : "p-0",
        )}
      >
        {/* Visa-like face (credit-card proportions) */}
        <div
          className={cn(
            "relative isolate overflow-hidden rounded-[calc(var(--radius-surface)-0.35rem)] bg-brand text-white",
            compact ? "p-4 sm:p-5" : "p-5 sm:p-6",
          )}
        >
          {/* Atmosphere */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,oklch(1_0_0/0.2),transparent_55%),radial-gradient(ellipse_at_100%_100%,oklch(0.45_0.14_260/0.45),transparent_50%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-10 h-36 w-36 rounded-full bg-brand-dark/50 blur-3xl"
          />

          <div className="relative z-10 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/sable-logo-light.svg"
                  alt=""
                  className={cn("w-auto", compact ? "h-4 sm:h-5" : "h-5 sm:h-6")}
                />
                <div className="text-left">
                  <p
                    className={cn(
                      "font-semibold tracking-tight",
                      compact ? "text-xs sm:text-sm" : "text-sm",
                    )}
                  >
                    Wotta
                  </p>
                  <p className="text-[11px] font-medium text-white/70">{label}</p>
                </div>
              </div>
              {status ? (
                <span className="radius-control border border-white/20 bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
                  {status}
                </span>
              ) : null}
            </div>

            {/* Chip — payment-card cue */}
            <div
              aria-hidden
              className={cn(
                "rounded-md bg-gradient-to-br from-white/35 via-white/20 to-white/10 shadow-inner ring-1 ring-white/25",
                compact
                  ? "mt-3 h-7 w-9 sm:mt-3.5 sm:h-8 sm:w-10"
                  : "mt-4 h-8 w-10 sm:h-9 sm:w-11",
              )}
            />

            <div className={cn(compact ? "mt-4" : "mt-5")}>
              <p
                className={cn(
                  "text-left font-bold tracking-tight",
                  compact ? "text-3xl sm:text-[2rem]" : "text-3xl sm:text-4xl",
                )}
              >
                <span className="inline-flex items-baseline gap-2">
                  <span>{amount}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 align-middle font-semibold text-white/90",
                      compact ? "text-sm sm:text-base" : "text-base sm:text-lg",
                    )}
                  >
                    <UsdcIcon
                      className={cn(compact ? "size-6 sm:size-7" : "size-7 sm:size-8")}
                    />
                    {assetLabel}
                  </span>
                </span>
              </p>
              {recipient ? (
                <p
                  className={cn(
                    "text-left text-white/80",
                    compact ? "mt-1 text-sm sm:text-base" : "mt-2 text-base sm:text-lg",
                  )}
                >
                  to {recipient}
                </p>
              ) : null}
              {note ? (
                <p
                  className={cn(
                    "break-all text-left font-mono leading-snug text-white/70",
                    compact
                      ? "mt-2 text-[10px] sm:text-[11px]"
                      : "mt-3 text-[11px] sm:text-xs",
                  )}
                >
                  {note}
                </p>
              ) : null}
              {children ? (
                <div className={cn("text-left", compact ? "mt-2" : "mt-3")}>
                  {children}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {footer ? (
          <div className="space-y-3 px-1 pb-1 pt-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
