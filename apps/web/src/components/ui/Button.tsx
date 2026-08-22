"use client";

import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/cn";
import { buttonTap } from "@/lib/motion";

type Variant = "brand" | "primary" | "secondary" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

type Props = {
  variant?: Variant;
  size?: Size;
  shape?: "pill" | "rounded";
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  "aria-disabled"?: boolean;
  "aria-busy"?: boolean;
  type?: "button" | "submit" | "reset";
  href?: string;
  target?: string;
  rel?: string;
  onClick?: () => void;
  "data-testid"?: string;
};

const variants: Record<Variant, string> = {
  brand: "bg-brand text-brand-foreground shadow-action hover:bg-brand-dark",
  primary: "bg-primary text-primary-foreground hover:bg-primary-dark",
  secondary: "bg-selection text-selection-foreground hover:bg-selection-hover",
  outline: "border-2 border-border bg-card text-foreground hover:bg-muted",
  danger: "border-2 border-destructive/30 bg-destructive/10 text-destructive",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

export function Button({
  variant = "brand",
  size = "md",
  shape = "pill",
  className,
  children,
  disabled,
  "aria-disabled": ariaDisabled,
  "aria-busy": ariaBusy,
  type = "button",
  href,
  target,
  rel,
  onClick,
  "data-testid": testId,
}: Props) {
  const reduce = useReducedMotion();
  const styles = cn(
    "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 font-semibold transition-colors duration-100 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card aria-disabled:cursor-not-allowed aria-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50",
    shape === "pill" ? "radius-control" : "rounded-lg",
    variants[variant],
    sizes[size],
    className,
  );

  if (href) {
    return (
      <motion.div
        whileTap={disabled || ariaDisabled || reduce ? undefined : buttonTap}
        className={cn("inline-flex", className?.includes("w-full") && "w-full")}
      >
        <a
          data-motion-button
          data-testid={testId}
          href={href}
          target={target}
          rel={rel}
          onClick={onClick}
          aria-disabled={disabled || ariaDisabled || undefined}
          className={styles}
        >
          {children}
        </a>
      </motion.div>
    );
  }

  return (
    <motion.button
      data-motion-button
      data-testid={testId}
      type={type}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      aria-busy={ariaBusy || undefined}
      onClick={onClick}
      whileTap={disabled || ariaDisabled || reduce ? undefined : buttonTap}
      className={styles}
    >
      {children}
    </motion.button>
  );
}
