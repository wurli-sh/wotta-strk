import type { SourceRail } from "@/components/SourceChips";
import type { NetworkMode } from "@/lib/network-mode";

const SOURCE_DOMAINS: Partial<Record<SourceRail, number>> = {
  ethereum: 0,
  arbitrum: 3,
  solana: 5,
  base: 6,
  stellar: 27,
};

/** Per-route explorer URL for a successful source (or Starknet) transaction. */
export function sourceTxExplorerUrl(
  route: SourceRail | null | undefined,
  txHash: string,
  network: NetworkMode = "testnet",
): string {
  if (network === "mainnet") {
    switch (route) {
      case "ethereum":
        return `https://etherscan.io/tx/${txHash}`;
      case "base":
        return `https://basescan.org/tx/${txHash}`;
      case "arbitrum":
        return `https://arbiscan.io/tx/${txHash}`;
      case "solana":
        return `https://explorer.solana.com/tx/${txHash}`;
      case "stellar":
        return `https://stellar.expert/explorer/public/tx/${txHash}`;
      case "starknet-public":
      case "starknet-private":
        return `https://voyager.online/tx/${txHash}`;
      default:
        return `https://voyager.online/tx/${txHash}`;
    }
  }
  switch (route) {
    case "ethereum":
      return `https://sepolia.etherscan.io/tx/${txHash}`;
    case "base":
      return `https://sepolia.basescan.org/tx/${txHash}`;
    case "arbitrum":
      return `https://sepolia.arbiscan.io/tx/${txHash}`;
    case "solana":
      return `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
    case "stellar":
      return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
    case "starknet-public":
    case "starknet-private":
      return `https://sepolia.voyager.online/tx/${txHash}`;
    default:
      return `https://sepolia.voyager.online/tx/${txHash}`;
  }
}

export function sourceTxExplorerLabel(route: SourceRail | null | undefined): string {
  if (route === "starknet-public" || route === "starknet-private") {
    return "Starknet transaction";
  }
  return "Source transaction";
}

export function irisMessageUrl(
  route: SourceRail | null | undefined,
  txHash: string,
  network: NetworkMode = "testnet",
): string | null {
  const domain = route ? SOURCE_DOMAINS[route] : undefined;
  if (domain === undefined) return null;
  const host = network === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
  return `${host}/v2/messages/${domain}?transactionHash=${txHash}`;
}
