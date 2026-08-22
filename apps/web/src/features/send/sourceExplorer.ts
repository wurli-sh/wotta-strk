import type { SourceRail } from "@/components/SourceChips";

/** Per-route explorer URL for a successful source (or Starknet) transaction. */
export function sourceTxExplorerUrl(
  route: SourceRail | null | undefined,
  txHash: string,
): string {
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
