"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buttonTap } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { DENS, type Dens } from "@/lib/denoms";

type Props = {
  value: Dens;
  onChange: (v: Dens) => void;
  disabled?: boolean;
  denominations?: readonly Dens[];
  /** Dens that render but cannot be selected (shown with a soon tag). */
  comingSoon?: ReadonlySet<Dens> | readonly Dens[];
};

function isComingSoon(d: Dens, comingSoon?: ReadonlySet<Dens> | readonly Dens[]): boolean {
  if (!comingSoon) return false;
  if (comingSoon instanceof Set) return comingSoon.has(d);
  return (comingSoon as readonly Dens[]).some((candidate) => candidate === d);
}

/** Fixed denominations as amount chips — single row, number only. */
export function DenomChips({
  value,
  onChange,
  disabled,
  denominations = DENS,
  comingSoon,
}: Props) {
  const reduce = useReducedMotion();

  return (
    <div className="text-center">
      <p className="text-sm font-semibold text-muted-foreground">Amount</p>
      <div
        role="group"
        aria-label="Amount"
        className={cn(
          "mt-3 grid w-full grid-cols-2 gap-2",
          denominations.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4",
        )}
      >
        {denominations.map((d) => {
          const selected = value === d;
          const label = d.toString();
          const soon = isComingSoon(d, comingSoon);
          const chipDisabled = disabled || soon;
          return (
            <motion.button
              key={label}
              data-motion-button
              type="button"
              data-testid={`denom-${label}`}
              data-status={soon ? "soon" : "live"}
              aria-pressed={selected}
              aria-disabled={chipDisabled || undefined}
              title={soon ? "Coming soon" : undefined}
              disabled={chipDisabled}
              whileTap={chipDisabled || reduce ? undefined : buttonTap}
              onClick={() => {
                if (soon) return;
                onChange(d);
              }}
              className={cn(
                "radius-control inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 border px-2 py-1.5 text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg",
                selected && !soon
                  ? "border-brand-muted/70 bg-brand/10 text-brand-ink shadow-soft"
                  : "border-border/60 bg-card/85 text-foreground/60 backdrop-blur-sm hover:bg-muted hover:text-foreground",
                chipDisabled && "cursor-not-allowed opacity-50 hover:bg-card/85 hover:text-foreground/60",
              )}
            >
              <span>{label}</span>
              {soon ? (
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  soon
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
