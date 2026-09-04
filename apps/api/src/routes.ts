import type { Config } from "./config.ts";
import { CIRCLE_MAINNET_ROUTES } from "@wotta/adapters";

export const ROUTES = [
  { id: "starknet-public", family: "starknet", domain: null, enabled: false, reason: "awaiting_verified_escrow_deployment" },
  { id: "ethereum", family: "cctp", domain: 0, enabled: false, reason: "coming_soon" },
  { id: "arbitrum", family: "cctp", domain: 3, enabled: false, reason: "coming_soon" },
  { id: "base", family: "cctp", domain: 6, enabled: false, reason: "awaiting_mainnet_destination" },
  { id: "solana", family: "cctp", domain: 5, enabled: false, reason: "awaiting_mainnet_destination" },
  { id: "stellar", family: "cctp", domain: 27, enabled: false, reason: "coming_soon" },
  { id: "starknet-private", family: "strk20", domain: null, enabled: false, reason: "awaiting_wallet_api_and_escrow_gate" },
] as const;
export type RouteId = (typeof ROUTES)[number]["id"];

/**
 * Routes that are never activated in this plan on mainnet (Ethereum, Arbitrum, Stellar).
 * They always return coming_soon regardless of manifest or admission state.
 */
const COMING_SOON_ON_MAINNET = new Set(["ethereum", "arbitrum", "stellar"]);

export function cctpPoolsForConfig(config: Config) {
  if (config.manifest.chainId !== "SN_MAIN") return config.manifest.pools;
  const approved = new Set(config.manifest.approvedCctpDenominations);
  return config.manifest.pools.filter((pool) => approved.has(pool.denomination));
}

export function verifiedEscrowPoolsForConfig(config: Config) {
  return cctpPoolsForConfig(config).filter((pool) =>
    pool.verification.status === "verified"
    && /^0x[0-9a-f]+$/i.test(pool.address)
    && /^0x[0-9a-f]+$/i.test(pool.classHash));
}

/** Mainnet Starknet-native sends use the same verified escrow/inbox/claim path as CCTP. */
export function starknetEscrowInboxReady(config: Config): boolean {
  if (config.manifest.chainId !== "SN_MAIN") return false;
  const pools = verifiedEscrowPoolsForConfig(config);
  return config.manifest.verified
    && config.manifest.router.verification.status === "verified"
    && config.manifest.walletManagedPrivacy?.status === "verified"
    && config.env.RUN_INDEXER
    && config.env.STARKNET_PRIVATE_ADMITTED
    && config.starknetPrivateEvidenceVerified
    && pools.length > 0;
}

export function routesForConfig(config: Config) {
  const isMainnet = config.manifest.chainId === "SN_MAIN";
  const cctpPools = cctpPoolsForConfig(config);
  const cctpReady = (!isMainnet || config.manifest.verified)
    && config.manifest.router.verification.status === "verified"
    && /^0x[0-9a-f]+$/i.test(config.manifest.router.address)
    && cctpPools.length > 0
    && cctpPools.every((pool) => pool.verification.status === "verified");
  const privateReady = isMainnet
    ? starknetEscrowInboxReady(config)
    : config.manifest.directPrivacy?.status === "verified"
      && config.manifest.directPrivacy.escrow?.status === "verified"
      && cctpReady;
  return ROUTES.map((route) => {
    if (route.id === "starknet-private") return {
      ...route,
      enabled: privateReady,
      reason: privateReady ? undefined : isMainnet ? "awaiting_verified_escrow_deployment" as const : route.reason,
    };
    if (route.id === "starknet-public") {
      const enabled = !isMainnet && cctpReady;
      return { ...route, enabled, reason: enabled ? undefined : isMainnet ? "coming_soon" as const : route.reason };
    }
    if (route.family !== "cctp") return route;
    // Routes permanently disabled on mainnet in this plan
    if (isMainnet && COMING_SOON_ON_MAINNET.has(route.id)) {
      return { ...route, enabled: false, reason: "coming_soon" as const };
    }
    if (isMainnet && !CIRCLE_MAINNET_ROUTES[route.id as "base" | "solana"]) {
      return { ...route, enabled: false, reason: "coming_soon" as const };
    }
    if (config.pilotPausedRoutes.has(route.id)) {
      return { ...route, enabled: false, reason: "route_paused" as const };
    }
    const admitted = config.admittedCctpRoutes.has(route.id);
    const workersReady = !isMainnet || (config.env.RUN_INDEXER && config.env.RUN_RELAYER);
    const dependencyReady = !isMainnet || config.runtimeVerifiedCctpRoutes.has(route.id);
    const enabled = cctpReady && admitted && workersReady && dependencyReady;
    return {
      ...route,
      enabled,
      reason: enabled
        ? undefined
        : !cctpReady
          ? "awaiting_mainnet_destination" as const
          : !admitted
            ? "awaiting_route_evidence" as const
            : !workersReady
              ? "worker_unavailable" as const
              : "dependency_unhealthy" as const,
    };
  });
}
export function routeById(routeId: string, config?: Config) { return (config ? routesForConfig(config) : ROUTES).find((route) => route.id === routeId); }
