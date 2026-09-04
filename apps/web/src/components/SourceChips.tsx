"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buttonTap } from "@/lib/motion";
import { routeLogoPath } from "@/lib/crypto-icons";
import { cn } from "@/lib/cn";
import { NOX_ROUTE_ID } from "@/features/send/routeIds";

export type SourceRail =
  | "ethereum"
  | "arbitrum"
  | "base"
  | "solana"
  | "stellar"
  | "starknet-public"
  | "starknet-private";

/** Chips shown under Pay from — one Starknet entry for public + private. */
export type SourceChipKey =
  | "ethereum"
  | "arbitrum"
  | "base"
  | "solana"
  | "stellar"
  | "starknet";

export type RouteRow = {
  key: SourceRail;
  status: "live" | "soon" | "paused";
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
  "starknet-private": "Starknet",
};

const DISPLAY_CHIPS: SourceChipKey[] = [
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
  "starknet",
];

export function isStarknetSource(source: SourceRail): boolean {
  return source === "starknet-public" || source === NOX_ROUTE_ID;
}

export function sourceChipKey(source: SourceRail): SourceChipKey {
  if (source === "starknet-public" || source === NOX_ROUTE_ID) return "starknet";
  return source;
}

export function resolveSourceRail(chip: SourceChipKey, privateMode: boolean): SourceRail {
  if (chip === "starknet") {
    return privateMode ? NOX_ROUTE_ID : "starknet-public";
  }
  return chip;
}

/** Maps API machine-reason codes to user-safe display copy. */
const REASON_COPY: Partial<Record<string, string>> = {
  coming_soon: "Coming soon",
  awaiting_mainnet_destination: "Verifying destination — coming soon",
  awaiting_route_evidence: "Awaiting route verification — coming soon",
  worker_unavailable: "Settlement service unavailable — coming soon",
  dependency_unhealthy: "Route dependency unavailable — coming soon",
  route_paused: "Paused",
  // Legacy testnet reason codes — kept for backwards compatibility
  awaiting_verified_destination: "Verifying destination — coming soon",
  awaiting_route_specific_live_evidence: "Awaiting route verification — coming soon",
  awaiting_verified_escrow_deployment: "Awaiting verified route — coming soon",
};

export function buildSourceRoutes(
  capabilities: Array<{ id: string; enabled: boolean; reason?: string }> = [],
): RouteRow[] {
  const byId = new Map(capabilities.map((route) => [route.id, route]));
  return (Object.keys(LABELS) as SourceRail[]).map((key) => {
    const capability = byId.get(key);
    const rawReason = capability?.reason;
    const paused = rawReason === "route_paused";
    return {
      key,
      status: capability?.enabled ? "live" : paused ? "paused" : "soon",
      selectable: capability?.enabled === true,
      label: LABELS[key],
      reason: REASON_COPY[rawReason ?? ""] ?? rawReason ?? "Awaiting verified testnet evidence",
    };
  });
}

export const TESTNET_SOURCE_ROUTES = buildSourceRoutes();

function routeForChip(
  routes: RouteRow[],
  chip: SourceChipKey,
  privateMode = false,
): RouteRow | undefined {
  if (chip === "starknet") {
    return routes.find((route) =>
      route.key === (privateMode ? NOX_ROUTE_ID : "starknet-public"),
    );
  }
  return routes.find((route) => route.key === chip);
}

export function chipSelectableInMode(
  chip: SourceChipKey,
  routes: RouteRow[],
  privateMode: boolean,
  allowCrossChainPrivateSources = false,
): boolean {
  if (chip === "starknet") {
    const target = privateMode
      ? routes.find((route) => route.key === NOX_ROUTE_ID)
      : routes.find((route) => route.key === "starknet-public");
    return target?.selectable === true;
  }
  if (privateMode && !allowCrossChainPrivateSources) return false;
  return routes.find((route) => route.key === chip)?.selectable === true;
}

/** Live/selectable chips first; preserve relative order within each group. */
export function orderedSourceChips(
  chips: readonly SourceChipKey[],
  routes: RouteRow[],
  privateMode: boolean,
  allowCrossChainPrivateSources = false,
): SourceChipKey[] {
  return [...chips].sort((left, right) => {
    const leftOn = chipSelectableInMode(left, routes, privateMode, allowCrossChainPrivateSources);
    const rightOn = chipSelectableInMode(right, routes, privateMode, allowCrossChainPrivateSources);
    if (leftOn === rightOn) return 0;
    return leftOn ? -1 : 1;
  });
}

type Props = {
  routes?: RouteRow[];
  value: SourceRail | null;
  onChange: (key: SourceRail) => void;
  disabled?: boolean;
  privateMode?: boolean;
  /** When private destination is locked (Mainnet), still allow admitted Base/Solana sources. */
  allowCrossChainPrivateSources?: boolean;
  unavailableReason?: string;
};

export function SourceChips({
  routes = TESTNET_SOURCE_ROUTES,
  value,
  onChange,
  disabled,
  privateMode = false,
  allowCrossChainPrivateSources = false,
  unavailableReason,
}: Props) {
  const reduce = useReducedMotion();
  const selectedChip = value ? sourceChipKey(value) : null;
  const chips = orderedSourceChips(
    DISPLAY_CHIPS,
    routes,
    privateMode,
    allowCrossChainPrivateSources,
  );

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-foreground">Pay from</p>
      <div
        role="listbox"
        aria-label="Pay from"
        className="flex flex-wrap gap-1.5"
      >
        {chips.map((chip) => {
          const route = routeForChip(routes, chip, privateMode);
          const on = chipSelectableInMode(chip, routes, privateMode, allowCrossChainPrivateSources);
          const selected = selectedChip === chip;
          const title = !on
            ? unavailableReason
              ?? (privateMode && !allowCrossChainPrivateSources && chip !== "starknet"
              ? "Switch off private route to use this source"
              : route?.reason ?? "Not selectable")
            : undefined;
          return (
            <motion.button
              key={chip}
              type="button"
              role="option"
              data-testid={`source-${chip}`}
              data-status={route?.status ?? "soon"}
              aria-selected={selected}
              disabled={disabled || !on}
              title={title}
              whileTap={disabled || !on || reduce ? undefined : buttonTap}
              onClick={() => onChange(resolveSourceRail(chip, privateMode))}
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
                src={routeLogoPath(chip === "starknet" ? "starknet-public" : chip)}
                alt=""
                width={24}
                height={24}
                className="size-6 shrink-0"
              />
              {chip === "starknet" ? "Starknet" : route?.label ?? chip}
              {route?.status === "paused" ? (
                <span className="text-[10px] font-medium uppercase tracking-wide text-warning">
                  paused
                </span>
              ) : route?.status === "soon" ? (
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
