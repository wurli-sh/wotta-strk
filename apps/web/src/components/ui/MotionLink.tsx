"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonTap } from "@/lib/motion";

type Props = {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: "brand" | "outline";
  "data-testid"?: string;
};

function motionStyles(variant: "brand" | "outline") {
  return variant === "brand"
    ? "bg-brand text-brand-foreground shadow-action hover:bg-brand-dark"
    : "border-2 border-border bg-card text-foreground hover:border-border-strong";
}

export function MotionLink({
  href,
  children,
  className,
  variant = "outline",
  "data-testid": testId,
}: Props) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      whileTap={reduce ? undefined : buttonTap}
      className="inline-flex"
    >
      <Link
        href={href}
        data-testid={testId}
        className={cn(
          "radius-control inline-flex min-h-10 items-center justify-center gap-2 px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          motionStyles(variant),
          className,
        )}
      >
        {children}
      </Link>
    </motion.div>
  );
}

export function MotionPillButton({
  children,
  className,
  disabled,
  "aria-busy": ariaBusy,
  type = "button",
  onClick,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-busy"?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  "data-testid"?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      data-motion-button
      data-testid={testId}
      type={type}
      disabled={disabled}
      aria-busy={ariaBusy}
      onClick={onClick}
      whileTap={disabled || reduce ? undefined : buttonTap}
      className={cn(
        "radius-control inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-action transition-colors duration-100 ease-out hover:bg-brand-dark outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-base",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

export function MotionButton({
  children,
  className,
  variant = "outline",
  type = "button",
  disabled = false,
  onClick,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "brand" | "outline";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  onClick: () => void;
  "data-testid"?: string;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      whileTap={reduce || disabled ? undefined : buttonTap}
      className="inline-flex"
    >
      <button
        data-motion-button
        data-testid={testId}
        type={type}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "radius-control inline-flex min-h-10 items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50",
          motionStyles(variant),
          className,
        )}
      >
        {children}
      </button>
    </motion.div>
  );
}
