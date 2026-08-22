"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { SignInAuthPanel } from "@/components/SignInAuthPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  onSignedIn?: () => void;
};

export function SignInModal({ open, onClose, onSignedIn }: Props) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  function handleAuthenticated() {
    onClose();
    onSignedIn?.();
    router.refresh();
  }

  const redirectNext =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}` || "/account"
      : "/account";

  const panelTransition = reduce
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <AnimatePresence>
      {open ? (
        <div
          key="signin-modal"
          className="fixed inset-0 z-[100] flex min-h-dvh w-full items-center justify-center overflow-y-auto px-4 py-8"
        >
          <motion.button
            type="button"
            aria-label="Close sign in"
            className="absolute inset-0 min-h-full w-full bg-ink/40 backdrop-blur-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-modal-title"
            tabIndex={-1}
            className="radius-surface relative z-10 my-auto w-full max-w-md max-h-[min(90dvh,40rem)] overflow-y-auto border border-border/80 bg-card p-2 shadow-card outline-none"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 8 }}
            transition={panelTransition}
          >
            <div className="radius-surface-inner border border-brand/15 bg-brand-mist p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2
                  id="signin-modal-title"
                  className="text-xl font-semibold tracking-tight text-foreground"
                >
                  Sign in
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="radius-control inline-flex size-11 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Sign in with Google, email, or X. X is only needed when you want
                a public Wotta @handle.
              </p>
              <div className="mt-6">
                <SignInAuthPanel
                  redirectNext={redirectNext}
                  onAuthenticated={handleAuthenticated}
                />
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
