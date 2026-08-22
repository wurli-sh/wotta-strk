/** CDN-backed testnet network and token icons. */

export type NetworkIconName =
  | "arc"
  | "base"
  | "arbitrum"
  | "ethereum"
  | "solana"
  | "stellar"
  | "starknet"
  ;

const NETWORK_CDN =
  "https://cdn.jsdelivr.net/gh/GMWalletApp/crypto-icons@latest/assets/networks/branded";

const TOKEN_CDN =
  "https://cdn.jsdelivr.net/gh/GMWalletApp/crypto-icons@latest/assets/tokens/branded";

const ICON_ID: Record<Exclude<NetworkIconName, "arc">, string> = {
  base: "base",
  arbitrum: "arbitrum-one",
  ethereum: "ethereum",
  solana: "solana",
  stellar: "stellar",
  starknet: "starknet",
};

export function networkIconUrl(name: NetworkIconName | string): string {
  if (name === "arc") return "/chains/arc.svg";
  if (name in ICON_ID) {
    return `${NETWORK_CDN}/${ICON_ID[name as keyof typeof ICON_ID]}.svg`;
  }
  return `${NETWORK_CDN}/ethereum.svg`;
}

export function tokenIconUrl(symbol: string): string {
  const s = symbol.toLowerCase();
  return `${TOKEN_CDN}/${s}.svg`;
}

export function networkIconFromRouteId(routeId: string): NetworkIconName {
  if (routeId.includes("starknet")) return "starknet";
  if (routeId === "arc" || routeId.includes("arc")) return "arc";
  if (routeId.includes("base")) return "base";
  if (routeId.includes("arbitrum")) return "arbitrum";
  if (routeId.includes("solana")) return "solana";
  if (routeId.includes("stellar") || routeId.includes("stel")) return "stellar";
  return "ethereum";
}

export function routeLogoPath(routeKey: string): string {
  return networkIconUrl(networkIconFromRouteId(routeKey));
}
