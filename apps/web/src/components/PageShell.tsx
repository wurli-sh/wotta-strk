import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Props = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  maxWidth?: "sm" | "md" | "lg";
};

const MAX: Record<NonNullable<Props["maxWidth"]>, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
};

export function PageShell({
  title,
  subtitle,
  children,
  className,
  maxWidth = "md",
}: Props) {
  return (
    <div className={cn("mx-auto w-full text-center", MAX[maxWidth], className)}>
      {title && (
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h1>
      )}
      {subtitle && (
        <p
          className={cn(
            "mx-auto max-w-md text-sm text-muted-foreground sm:text-base",
            title ? "mt-3" : "",
          )}
        >
          {subtitle}
        </p>
      )}
      <div className={cn("text-left", title || subtitle ? "mt-8" : "")}>
        {children}
      </div>
    </div>
  );
}
