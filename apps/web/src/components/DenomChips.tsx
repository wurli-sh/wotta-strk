"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buttonTap } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { DENS, type Dens } from "@/lib/denoms";

type Props = {
  value: Dens;
  onChange: (v: Dens) => void;
  disabled?: boolean;
};

/** Fixed dens as amount chips — single row, number only. */
export function DenomChips({ value, onChange, disabled }: Props) {
  const reduce = useReducedMotion();

  return (
    <div className="text-center">
      <p className="text-sm font-semibold text-muted-foreground">Amount</p>
      <div
        role="group"
        aria-label="Amount"
        className="mt-3 grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {DENS.map((d) => {
          const selected = value === d;
          const label = d.toString();
          return (
            <motion.button
              key={label}
              data-motion-button
              type="button"
              data-testid={`denom-${label}`}
              aria-pressed={selected}
              disabled={disabled}
              whileTap={disabled || reduce ? undefined : buttonTap}
              onClick={() => onChange(d)}
              className={cn(
                "radius-control min-h-10 cursor-pointer border px-1.5 py-1.5 text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg",
                selected
                  ? "border-brand-muted/70 bg-brand/10 text-brand-ink shadow-soft"
                  : "border-border/60 bg-card/85 text-foreground/60 backdrop-blur-sm hover:bg-muted hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
