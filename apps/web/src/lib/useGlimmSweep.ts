"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useGlimm } from "glimm/next";

/** Prime WebGL and play the same sweep used by the private-route toggle. */
export function useGlimmSweep() {
  const { sweep } = useGlimm();
  const reduce = useReducedMotion();
  const warmed = useRef(false);

  useEffect(() => {
    if (warmed.current || reduce) return;
    warmed.current = true;
    sweep(() => {}, { sweepMs: 1, outroMs: 1, peakAlpha: 0, midpoint: 0 }).cancel();
  }, [sweep, reduce]);

  return useCallback(
    (enabled: boolean) => {
      if (reduce) return;
      sweep(() => {}, {
        direction: enabled ? "ltr" : "rtl",
      });
    },
    [reduce, sweep],
  );
}
