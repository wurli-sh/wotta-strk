"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export function TextShimmer({
  children,
  className,
  active = true,
  tone = "brand",
}: {
  children: string;
  className?: string;
  active?: boolean;
  /** `on-dark` avoids brand-blue sweep on charcoal buttons. */
  tone?: "brand" | "on-dark";
}) {
  const reduce = useReducedMotion();
  if (!active || reduce) {
    return <span className={className}>{children}</span>;
  }
  const sweep =
    tone === "on-dark"
      ? "bg-[linear-gradient(90deg,currentColor,rgba(255,255,255,0.92),currentColor)]"
      : "bg-[linear-gradient(90deg,currentColor,var(--color-brand),currentColor)]";
  return (
    <span className={cn("relative inline-flex items-center leading-none overflow-hidden", className)}>
      <span className="leading-none opacity-40">{children}</span>
      <motion.span
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center bg-[length:200%_100%] bg-clip-text leading-none text-transparent",
          sweep,
        )}
        animate={{ backgroundPosition: ["100% center", "-100% center"] }}
        transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
      >
        {children}
      </motion.span>
    </span>
  );
}
