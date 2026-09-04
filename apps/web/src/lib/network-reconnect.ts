import type { NetworkMode } from "@/lib/network-mode";

export const WALLET_RECONNECT_REQUEST_EVENT = "wotta-wallet-reconnect-request";

export type WalletReconnectRequest = {
  linkedWalletAddress?: string | null;
  /** When true, skip the intro dialog and open the wallet modal immediately. */
  immediate?: boolean;
};

export function requestWalletReconnect(detail: WalletReconnectRequest = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WALLET_RECONNECT_REQUEST_EVENT, { detail }));
}

export function isPrivacyReconnectError(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  return (
    lower.includes("privacy_viewing_key_mismatch")
    || lower.includes("viewing_key does not match")
    || lower.includes("wallet_binding_ambiguous")
  );
}

export function networkReconnectTitle(mode: NetworkMode): string {
  return mode === "mainnet" ? "Reconnect Ready on Mainnet" : "Reconnect Ready on Sepolia";
}

export function networkReconnectBody(mode: NetworkMode): string {
  return mode === "mainnet"
    ? "Mainnet uses a separate wallet binding and private balance. Sign with Ready again to unlock local state and refresh your live balance."
    : "Testnet uses its own wallet binding and private vault. Sign with Ready again to rebuild notes and reveal your private balance.";
}
