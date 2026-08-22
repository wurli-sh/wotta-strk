"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";

export function TextShimmer({
  children,
  className,
  active = true,
}: {
  children: string;
  className?: string;
  active?: boolean;
}) {
  const reduce = useReducedMotion();
  if (!active || reduce) {
    return <span className={className}>{children}</span>;
  }
  return (
    <span className={cn("relative inline-flex items-center leading-none overflow-hidden", className)}>
      <span className="leading-none opacity-40">{children}</span>
      <motion.span
        aria-hidden
        className="absolute inset-0 flex items-center bg-[linear-gradient(90deg,currentColor,var(--color-brand),currentColor)] bg-[length:200%_100%] bg-clip-text leading-none text-transparent"
        animate={{ backgroundPosition: ["100% center", "-100% center"] }}
        transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
      >
        {children}
      </motion.span>
    </span>
  );
}
