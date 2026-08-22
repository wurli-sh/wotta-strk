import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { UsdcIcon } from "@/components/UsdcIcon";

export type NoteCardRow = {
  icon?: ReactNode;
  label: string;
};

export type NoteCardFooter = {
  value: string;
  caption: string;
};

type Variant = "sky" | "lavender" | "mist";

const MESH: Record<Variant, string> = {
  sky: "from-brand-mist via-brand-soft to-card",
  lavender: "from-brand-soft via-brand-lavender to-card",
  mist: "from-muted via-brand-mist to-card",
};

type Props = {
  label?: string;
  subtitle?: string;
  amount?: string;
  title: string;
  badge?: string;
  badgeTone?: "success" | "muted" | "warning";
  rows?: NoteCardRow[];
  footer?: [NoteCardFooter, NoteCardFooter?];
  variant?: Variant;
  action?: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  children?: ReactNode;
};

const BADGE: Record<NonNullable<Props["badgeTone"]>, string> = {
  success: "bg-success/15 text-success",
  muted: "bg-white/70 text-muted-foreground",
  warning: "bg-warning-surface text-warning",
};

export function NoteCard({
  label = "Private note",
  subtitle,
  amount,
  title,
  badge,
  badgeTone = "success",
  rows = [],
  footer,
  variant = "sky",
  action,
  headerAction,
  className,
  children,
}: Props) {
  const hero = amount ?? title.replace(/\s*USDC\s*$/i, "").trim();

  return (
    <div
      className={cn(
        "relative z-0 isolate radius-surface overflow-hidden border border-border/80 bg-card p-2.5 text-left shadow-card sm:p-3",
        className,
      )}
    >
      <div
        className={cn(
          "relative z-0 isolate radius-surface-inner overflow-hidden bg-gradient-to-br p-5 sm:p-6 [clip-path:inset(0_round_var(--radius-surface-inner))]",
          MESH[variant],
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/50 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 left-8 h-36 w-36 rounded-full bg-brand/10 blur-2xl"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 select-none text-[4.5rem] font-black leading-none tracking-tighter text-brand-ink/[0.06] sm:text-[5.5rem]"
        >
          WOTTA
        </span>

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">
              {label}
            </p>
            {subtitle && (
              <p className="mt-1 truncate text-sm font-bold tracking-tight text-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && (
            <div className="shrink-0 text-muted-foreground">{headerAction}</div>
          )}
        </div>

        <p className="relative mt-10 text-center text-4xl font-bold tracking-tight text-foreground sm:mt-12 sm:text-5xl">
          {hero}
        </p>
        <p className="relative mt-1 flex items-center justify-center gap-1.5 text-center text-sm text-muted-foreground">
          <UsdcIcon className="size-4" />
          USDC
        </p>

        <div className="relative mt-8 flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {rows.slice(0, 3).map((row) => (
              <span
                key={row.label}
                className="radius-control inline-flex max-w-[11rem] items-center gap-1.5 bg-card/65 px-2.5 py-1 text-[11px] font-medium text-brand-ink/80 backdrop-blur-sm"
                title={row.label}
              >
                {row.icon}
                <span className="truncate">{row.label}</span>
              </span>
            ))}
          </div>
          {badge && (
            <span
              className={cn(
                "radius-control shrink-0 px-2.5 py-1 text-[11px] font-semibold",
                BADGE[badgeTone],
              )}
            >
              {badge}
            </span>
          )}
        </div>

        {children}
      </div>

      {footer && (
        <div className="grid grid-cols-2 gap-4 px-4 pb-2 pt-4 sm:px-5">
          {footer.map((col, i) =>
            col ? (
              <div key={i}>
                <p className="text-lg font-bold tracking-tight text-foreground">
                  {col.value}
                </p>
                <p className="text-xs text-muted-foreground">{col.caption}</p>
              </div>
            ) : null,
          )}
        </div>
      )}

      {action && (
        <div className="flex flex-wrap gap-2 px-1 pb-1 pt-3 sm:px-1.5">
          {action}
        </div>
      )}
    </div>
  );
}

export function SoftPillButton({
  children,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        "radius-control inline-flex min-h-14 flex-1 cursor-pointer items-center justify-center gap-2 bg-muted px-6 text-base font-semibold text-foreground transition-colors hover:bg-selection disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
