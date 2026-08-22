import type { Config } from "./config.ts";

export const ROUTES = [
  { id: "starknet-public", family: "starknet", domain: 25, enabled: false, reason: "awaiting_verified_escrow_deployment" },
  { id: "ethereum", family: "cctp", domain: 0, enabled: false, reason: "awaiting_live_cctp_smoke" },
  { id: "arbitrum", family: "cctp", domain: 3, enabled: false, reason: "awaiting_live_cctp_smoke" },
  { id: "base", family: "cctp", domain: 6, enabled: false, reason: "awaiting_live_cctp_smoke" },
  { id: "solana", family: "cctp", domain: 5, enabled: false, reason: "awaiting_live_cctp_smoke" },
  { id: "stellar", family: "cctp", domain: 27, enabled: false, reason: "awaiting_live_cctp_smoke" },
  { id: "starknet-private", family: "strk20", domain: null, enabled: false, reason: "awaiting_wallet_api_and_escrow_gate" },
] as const;
export type RouteId = (typeof ROUTES)[number]["id"];
export function routesForConfig(config: Config) {
  const cctpReady = config.manifest.router.verification.status === "verified"
    && /^0x[0-9a-f]+$/i.test(config.manifest.router.address)
    && config.manifest.pools.every((pool) => pool.verification.status === "verified");
  const privateReady = config.manifest.directPrivacy?.status === "verified"
    && config.manifest.directPrivacy.escrow?.status === "verified";
  return ROUTES.map((route) => {
    if (route.id === "starknet-private") return { ...route, enabled: privateReady, reason: privateReady ? undefined : route.reason };
    if (route.id === "starknet-public") {
      return { ...route, enabled: cctpReady, reason: cctpReady ? undefined : route.reason };
    }
    if (route.family !== "cctp") return route;
    const admitted = config.admittedCctpRoutes.has(route.id);
    const enabled = cctpReady && admitted;
    return {
      ...route,
      enabled,
      reason: enabled
        ? undefined
        : !cctpReady
          ? "awaiting_verified_destination"
          : "awaiting_route_specific_live_evidence",
    };
  });
}
export function routeById(routeId: string, config?: Config) { return (config ? routesForConfig(config) : ROUTES).find((route) => route.id === routeId); }
