"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buttonTap } from "@/lib/motion";
import { routeLogoPath } from "@/lib/crypto-icons";
import { cn } from "@/lib/cn";

export type SourceRail =
  | "ethereum"
  | "arbitrum"
  | "base"
  | "solana"
  | "stellar"
  | "starknet-public"
  | "starknet-private";

export type RouteRow = {
  key: SourceRail;
  status: "live" | "soon";
  selectable: boolean;
  label: string;
  reason?: string | null;
};

const LABELS: Record<SourceRail, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  base: "Base",
  solana: "Solana",
  stellar: "Stellar",
  "starknet-public": "Starknet",
  "starknet-private": "Private",
};

export function buildSourceRoutes(
  capabilities: Array<{ id: string; enabled: boolean; reason?: string }> = [],
): RouteRow[] {
  const byId = new Map(capabilities.map((route) => [route.id, route]));
  return (Object.keys(LABELS) as SourceRail[]).map((key) => {
    const capability = byId.get(key);
    return {
      key,
      status: capability?.enabled ? "live" : "soon",
      selectable: capability?.enabled === true,
      label: LABELS[key],
      reason: capability?.reason ?? "Awaiting verified testnet evidence",
    };
  });
}

export const TESTNET_SOURCE_ROUTES = buildSourceRoutes();

type Props = {
  routes?: RouteRow[];
  value: string | null;
  onChange: (key: SourceRail) => void;
  disabled?: boolean;
};

export function SourceChips({
  routes = TESTNET_SOURCE_ROUTES,
  value,
  onChange,
  disabled,
}: Props) {
  const reduce = useReducedMotion();

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">Pay using</p>
      <div
        role="listbox"
        aria-label="Pay using"
        className="flex flex-wrap gap-1.5"
      >
        {routes.map((r) => {
          const on = r.selectable;
          const selected = value === r.key;
          return (
            <motion.button
              key={r.key}
              type="button"
              role="option"
              data-testid={`source-${r.key}`}
              data-status={r.status}
              aria-selected={selected}
              disabled={disabled || !on}
              title={!on ? (r.reason ?? "Not selectable") : undefined}
              whileTap={disabled || !on || reduce ? undefined : buttonTap}
              onClick={() => onChange(r.key)}
              className={cn(
                "radius-control inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-3.5 sm:py-2.5 sm:text-sm",
                selected
                  ? "border-brand-muted bg-brand-soft text-brand-ink"
                  : "border-border/60 bg-card text-foreground/70 hover:bg-muted hover:text-foreground",
                (!on || disabled) && "cursor-not-allowed opacity-50",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={routeLogoPath(r.key)}
                alt=""
                width={24}
                height={24}
                className="size-6 shrink-0"
              />
              {r.label}
              {r.status === "soon" ? (
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  soon
                </span>
              ) : null}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
