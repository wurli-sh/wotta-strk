import { publicKeyFromSecret } from "@wotta/crypto";
import type { NetworkMode } from "@/lib/network-mode";

export type InboxLinkStatus =
  | "checking"
  | "signed_out"
  | "unlinked"
  | "locked"
  | "valid"
  | "wrong_wallet"
  | "key_mismatch"
  | "network_mismatch";

type InboxBinding = {
  address: string;
  inbox_pubkey: string;
} | null;

/** Passive validation: this never opens Ready or asks the wallet to switch chains. */
export function validateInboxBinding(
  binding: InboxBinding,
  inboxSecretKey?: string,
  connectedAddress?: string,
): InboxLinkStatus {
  if (!binding) return "unlinked";
  if (connectedAddress && BigInt(connectedAddress) !== BigInt(binding.address)) {
    return "wrong_wallet";
  }
  if (!inboxSecretKey) return "locked";
  try {
    return publicKeyFromSecret(inboxSecretKey) === binding.inbox_pubkey
      ? "valid"
      : "key_mismatch";
  } catch {
    return "key_mismatch";
  }
}

export function inboxLinkWarning(mode: NetworkMode, status: InboxLinkStatus): string | null {
  const network = mode === "mainnet" ? "Mainnet" : "Sepolia";
  switch (status) {
    case "network_mismatch":
      return `${network} is pointing at the other network API. Do not send or claim until the API URL is fixed.`;
    case "unlinked":
      return `No Ready inbox is linked on ${network}. Link Ready before receiving a private payment.`;
    case "locked":
      return `${network} inbox is linked but not validated in this browser. Unlock it before receiving or claiming.`;
    case "wrong_wallet":
      return `The connected Ready account does not match your ${network} inbox link.`;
    case "key_mismatch":
      return `${network} inbox key does not match the active link. Do not receive new payments; use the original browser or deliberately unlink and re-link.`;
    default:
      return null;
  }
}
