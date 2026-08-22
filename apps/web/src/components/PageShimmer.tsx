"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SKELETON_MIN_MS } from "@/lib/skeleton-hold";

/**
 * In-panel skeleton hold (tabs / refresh regions).
 * Holds skeleton for a mandatory minimum, then fades content in.
 * Does not remount page chrome (title, segmented tabs).
 */
export function TabContentShimmer({
  skeleton,
  children,
  holdKey,
  minMs = SKELETON_MIN_MS,
}: {
  skeleton: ReactNode;
  children: ReactNode;
  holdKey: string | number;
  minMs?: number;
}) {
  return (
    <PageShimmer
      skeleton={skeleton}
      holdKey={holdKey}
      minMs={minMs}
      animateContent
    >
      {children}
    </PageShimmer>
  );
}

/**
 * Holds a shimmer skeleton for a mandatory minimum duration, then reveals children.
 * Prefer for in-panel remounts; full routes use RouteSkeletonGate.
 */
export function PageShimmer({
  skeleton,
  children,
  minMs = SKELETON_MIN_MS,
  animateContent = true,
  /** Remount hold when this changes (tabs, refresh keys). */
  holdKey = "default",
}: {
  skeleton: ReactNode;
  children: ReactNode;
  minMs?: number;
  animateContent?: boolean;
  holdKey?: string | number;
}) {
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    // Always enforce min hold — including when user prefers reduced motion.
    const id = window.setTimeout(() => setReady(true), minMs);
    return () => window.clearTimeout(id);
  }, [minMs, holdKey]);

  return (
    <AnimatePresence mode="wait">
      {!ready ? (
        <motion.div
          key={`shimmer-${holdKey}`}
          initial={reduce ? false : { opacity: 0.7 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key={`content-${holdKey}`}
          initial={reduce || !animateContent ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduce || !animateContent
              ? { duration: 0 }
              : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
