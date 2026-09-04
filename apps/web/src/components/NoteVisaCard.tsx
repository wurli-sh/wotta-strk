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
                <span className="inline-flex max-w-[10.5rem] shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/20 px-2.5 py-1.5 text-center text-[10px] font-bold uppercase leading-none tracking-[0.12em] text-white">
                  {status}
                </span>
              ) : null}
            </div>

            {/* Spacer — preserves visa-card proportions after chip removal */}
            <div
              aria-hidden
              className={cn(
                compact
                  ? "mt-3 h-7 sm:mt-3.5 sm:h-8"
                  : "mt-4 h-8 sm:h-9",
              )}
            />

            <div className={cn(compact ? "mt-4" : "mt-5")}>
              <p
                className={cn(
                  "text-left font-bold tracking-tight",
                  compact ? "text-3xl sm:text-[2rem]" : "text-3xl sm:text-4xl",
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{amount}</span>
                  <UsdcIcon
                    className={cn(
                      "drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]",
                      compact ? "size-6 sm:size-7" : "size-7 sm:size-8",
                    )}
                  />
                  <span className="sr-only">{assetLabel}</span>
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
          <div className="space-y-2 px-1 pb-1 pt-2">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
