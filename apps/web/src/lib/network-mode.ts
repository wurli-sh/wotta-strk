export type NetworkMode = "testnet" | "mainnet";

export const NETWORK_MODE_STORAGE_KEY = "wotta-network-mode";
export const NETWORK_MODE_EVENT = "wotta-network-mode-changed";

export function readNetworkMode(): NetworkMode {
  if (typeof window === "undefined") return "testnet";
  return window.localStorage.getItem(NETWORK_MODE_STORAGE_KEY) === "mainnet"
    ? "mainnet"
    : "testnet";
}

export function chainIdForMode(mode: NetworkMode): "SN_SEPOLIA" | "SN_MAIN" {
  return mode === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA";
}

export function starkscanTransactionUrl(mode: NetworkMode, hash: string): string {
  const network = mode === "mainnet" ? "mainnet" : "sepolia";
  return `https://starkscan.co/tx/${hash}?network=${network}`;
}
