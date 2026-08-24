"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { SKELETON_MAX_MS } from "@/lib/skeleton-hold";

/**
 * In-panel skeleton (tabs / refresh regions).
 * Skips shimmer when `ready` is true; shows skeleton only while loading.
 */
export function TabContentShimmer({
  skeleton,
  children,
  holdKey,
  ready = true,
  maxMs = SKELETON_MAX_MS,
}: {
  skeleton: ReactNode;
  children: ReactNode;
  holdKey: string | number;
  /** When true, render children immediately with no skeleton flash. */
  ready?: boolean;
  maxMs?: number;
}) {
  return (
    <PageShimmer
      skeleton={skeleton}
      holdKey={holdKey}
      ready={ready}
      maxMs={maxMs}
      animateContent
    >
      {children}
    </PageShimmer>
  );
}

/**
 * Shows skeleton only while `ready` is false. When ready, reveals content immediately.
 */
export function PageShimmer({
  skeleton,
  children,
  ready = true,
  maxMs = SKELETON_MAX_MS,
  animateContent = true,
  holdKey = "default",
}: {
  skeleton: ReactNode;
  children: ReactNode;
  ready?: boolean;
  maxMs?: number;
  animateContent?: boolean;
  holdKey?: string | number;
}) {
  const reduce = useReducedMotion();
  const [showContent, setShowContent] = useState(ready);
  const instantReveal = useState(() => ready)[0];

  useEffect(() => {
    if (ready) {
      setShowContent(true);
      return;
    }
    setShowContent(false);
    const id = window.setTimeout(() => setShowContent(true), maxMs);
    return () => window.clearTimeout(id);
  }, [ready, maxMs, holdKey]);

  if (ready || showContent) {
    if (reduce || !animateContent || instantReveal) {
      return <div key={`content-${holdKey}`}>{children}</div>;
    }
    return (
      <motion.div
        key={`content-${holdKey}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`shimmer-${holdKey}`}
        initial={reduce ? false : { opacity: 0.85 }}
        animate={{ opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.12 }}
      >
        {skeleton}
      </motion.div>
    </AnimatePresence>
  );
}
