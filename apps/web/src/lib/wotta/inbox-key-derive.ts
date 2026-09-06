import {
  deriveInboxKeyPairFromSignature,
  inboxKeyTypedData,
  type InboxKeyChainId,
  type InboxKeyPair,
} from "@wotta/crypto";
import { stark, type WalletAccountV6 } from "starknet";
import { ensureReadyChain } from "./ready.ts";

export async function deriveInboxKeyPair(
  account: WalletAccountV6,
  chainId: InboxKeyChainId,
): Promise<InboxKeyPair> {
  const mode = chainId === "SN_MAIN" ? "mainnet" : "testnet";
  await ensureReadyChain(account, mode);
  const typedData = inboxKeyTypedData(account.address, chainId);
  const parts = stark.formatSignature(await account.signMessage(typedData));
  return deriveInboxKeyPairFromSignature(parts, chainId, account.address);
}

export function chainIdForNetwork(
  network: "mainnet" | "testnet",
): InboxKeyChainId {
  return network === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA";
}
