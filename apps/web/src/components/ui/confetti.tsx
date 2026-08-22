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
  useState,
} from "react";
import { createPortal } from "react-dom";
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

/**
 * Portals to document.body so Framer Motion transforms on page ancestors
 * cannot trap `position: fixed` and clip the burst (common in tab shells).
 */
const ConfettiComponent = forwardRef<ConfettiRef, Props>((props, ref) => {
  const {
    options,
    globalOptions = { resize: true, useWorker: false },
    manualstart = false,
    children,
    className,
    ...rest
  } = props;

  const canvasNodeRef = useRef<HTMLCanvasElement | null>(null);
  const instanceRef = useRef<ConfettiInstance | null>(null);
  const optionsRef = useRef(options);
  const globalOptionsRef = useRef(globalOptions);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    globalOptionsRef.current = globalOptions;
  }, [globalOptions]);

  useEffect(() => {
    if (!mounted) return;
    const node = canvasNodeRef.current;
    if (!node || instanceRef.current) return;

    const syncSize = () => {
      node.width = window.innerWidth;
      node.height = window.innerHeight;
    };
    syncSize();

    instanceRef.current = confetti.create(node, {
      resize: true,
      useWorker: false,
      ...globalOptionsRef.current,
    });

    window.addEventListener("resize", syncSize);
    return () => {
      window.removeEventListener("resize", syncSize);
      instanceRef.current?.reset();
      instanceRef.current = null;
    };
  }, [mounted]);

  const fire = useCallback(async (opts: ConfettiOptions = {}) => {
    try {
      const payload = { ...optionsRef.current, ...opts };
      if (instanceRef.current) {
        return await instanceRef.current(payload);
      }
      // Fallback when the canvas instance is not ready yet.
      return await confetti(payload);
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

  const canvas = (
    <canvas
      ref={canvasNodeRef}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-[10000] h-screen w-screen",
        className,
      )}
      {...rest}
    />
  );

  return (
    <ConfettiContext.Provider value={api}>
      {mounted ? createPortal(canvas, document.body) : null}
      {children}
    </ConfettiContext.Provider>
  );
});

ConfettiComponent.displayName = "Confetti";

export const Confetti = ConfettiComponent;
