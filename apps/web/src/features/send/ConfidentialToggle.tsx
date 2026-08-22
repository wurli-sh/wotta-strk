"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useGlimm } from "glimm/next";
import { cn } from "@/lib/cn";
import { buttonTap, navSpring } from "@/lib/motion";

type Props = {
  enabled: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
};

export function ConfidentialToggle({ enabled, disabled, onChange }: Props) {
  const { sweep } = useGlimm();
  const reduce = useReducedMotion();
  const warmed = useRef(false);

  // First sweep builds WebGL lazily — prime it so the first toggle isn't stalled.
  useEffect(() => {
    if (warmed.current || reduce) return;
    warmed.current = true;
    sweep(() => {}, { sweepMs: 1, outroMs: 1, peakAlpha: 0, midpoint: 0 }).cancel();
  }, [sweep, reduce]);

  const toggle = () => {
    if (disabled) return;
    const next = !enabled;
    onChange(next);
    if (reduce) return;
    sweep(() => {}, {
      direction: next ? "ltr" : "rtl",
    });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Private route</p>
        <p className="text-xs text-muted-foreground">
          Send private balance on Starknet
        </p>
      </div>
      <motion.button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Private route send mode"
        disabled={disabled}
        onClick={toggle}
        whileTap={disabled || reduce ? undefined : buttonTap}
        animate={{
          backgroundColor: enabled
            ? "var(--color-brand)"
            : "var(--color-muted)",
          borderColor: enabled
            ? "var(--color-brand-muted)"
            : "color-mix(in oklab, var(--color-border) 80%, transparent)",
        }}
        transition={reduce ? { duration: 0 } : navSpring}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          disabled && "cursor-not-allowed opacity-40",
        )}
      >
        <motion.span
          className="absolute top-0.5 size-5 rounded-full bg-card shadow-sm"
          animate={{ left: enabled ? 24 : 2 }}
          transition={reduce ? { duration: 0 } : navSpring}
          aria-hidden
        />
      </motion.button>
    </div>
  );
}
