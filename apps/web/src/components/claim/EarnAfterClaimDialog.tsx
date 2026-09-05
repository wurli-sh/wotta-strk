"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function EarnAfterClaimDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return <AnimatePresence>{open ? <div className="fixed inset-0 z-[95] flex min-h-dvh items-center justify-center px-4 py-8"><motion.button type="button" aria-label="Dismiss earn prompt" className="absolute inset-0 min-h-full w-full bg-ink/40 backdrop-blur-[2px]" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} onClick={onClose} /><motion.div role="dialog" aria-modal="true" aria-labelledby="earn-after-claim-title" className="radius-surface relative z-10 w-full max-w-md border border-border/80 bg-card p-2 shadow-card" initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: 8 }}><div className="radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink"><Sparkles className="size-4" /></span><div><h2 id="earn-after-claim-title" className="text-lg font-semibold tracking-tight">Put your USDC to work?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your claimed USDC is private. You can choose to supply it to Vesu at a variable rate; the Vesu action and amount are visible onchain. Nothing is deposited automatically.</p></div></div><button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="radius-control inline-flex size-10 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/60 hover:text-foreground"><X className="size-5" /></button></div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button className="flex-1" href="/account?tab=earn">Earn on Vesu</Button><Button className="flex-1" variant="outline" onClick={onClose}>Not now</Button></div></div></motion.div></div> : null}</AnimatePresence>;
}
