"use client";

import type { ReactNode } from "react";
import React, {
  createContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type {
  GlobalOptions as ConfettiGlobalOptions,
  CreateTypes as ConfettiInstance,
  Options as ConfettiOptions,
} from "canvas-confetti";
import confetti from "canvas-confetti";
import { cn } from "@/lib/cn";

export type ConfettiRef = {
  fire: (options?: ConfettiOptions) => Promise<null | undefined>;
};

type Props = React.ComponentPropsWithRef<"canvas"> & {
  options?: ConfettiOptions;
  globalOptions?: ConfettiGlobalOptions;
  manualstart?: boolean;
  children?: ReactNode;
};

const ConfettiContext = createContext<ConfettiRef | null>(null);

const ConfettiComponent = forwardRef<ConfettiRef, Props>((props, ref) => {
  const {
    options,
    globalOptions = { resize: true, useWorker: true },
    manualstart = false,
    children,
    className,
    ...rest
  } = props;

  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<ConfettiInstance | null>(null);
  const optionsRef = useRef(options);
  const globalOptionsRef = useRef(globalOptions);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    globalOptionsRef.current = globalOptions;
  }, [globalOptions]);

  useEffect(() => {
    if (canvasNodeRef.current && !instanceRef.current) {
      instanceRef.current = confetti.create(canvasNodeRef.current, {
        resize: true,
        useWorker: true,
        ...globalOptionsRef.current,
      });
    }

    return () => {
      instanceRef.current?.reset();
      instanceRef.current = null;
    };
  }, []);

  const fire = useCallback(async (opts: ConfettiOptions = {}) => {
    try {
      return await instanceRef.current?.({
        ...optionsRef.current,
        ...opts,
      });
    } catch (error) {
      console.error("Confetti error:", error);
      return null;
    }
  }, []);

  const api = useMemo(() => ({ fire }), [fire]);

  useImperativeHandle(ref, () => api, [api]);

  useEffect(() => {
    if (!manualstart) {
      void fire();
    }
  }, [manualstart, fire]);

  return (
    <ConfettiContext.Provider value={api}>
      <canvas
        ref={canvasNodeRef}
        className={cn("pointer-events-none", className)}
        {...rest}
      />
      {children}
    </ConfettiContext.Provider>
  );
});

ConfettiComponent.displayName = "Confetti";

export const Confetti = ConfettiComponent;

/** Brand cobalt / mist palette for claim celebration. */
export const CLAIM_CONFETTI_COLORS = [
  "#2c5cc5",
  "#4674d2",
  "#c8d8fb",
  "#e7eeff",
  "#244ca6",
] as const;

export function fireClaimConfetti(confettiRef: ConfettiRef | null): void {
  if (!confettiRef) return;
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  void confettiRef.fire({
    particleCount: 55,
    spread: 64,
    startVelocity: 36,
    origin: { y: 0.62 },
    colors: [...CLAIM_CONFETTI_COLORS],
    zIndex: 10_000,
  });

  const end = Date.now() + 1_100;
  const frame = () => {
    if (Date.now() > end) return;
    void confettiRef.fire({
      particleCount: 2,
      angle: 60,
      spread: 50,
      startVelocity: 48,
      origin: { x: 0, y: 0.65 },
      colors: [...CLAIM_CONFETTI_COLORS],
      zIndex: 10_000,
    });
    void confettiRef.fire({
      particleCount: 2,
      angle: 120,
      spread: 50,
      startVelocity: 48,
      origin: { x: 1, y: 0.65 },
      colors: [...CLAIM_CONFETTI_COLORS],
      zIndex: 10_000,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
