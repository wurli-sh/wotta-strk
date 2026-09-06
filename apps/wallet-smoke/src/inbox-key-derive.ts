import {
  deriveInboxKeyPairFromSignature,
  inboxKeyTypedData,
  type InboxKeyChainId,
  type InboxKeyPair,
} from "@wotta/crypto";
import { constants, stark, type WalletAccountV6 } from "starknet";

export async function deriveInboxKeyPair(
  account: WalletAccountV6,
  chainId: InboxKeyChainId,
): Promise<InboxKeyPair> {
  await account.switchStarknetChain(
    chainId === "SN_MAIN"
      ? constants.StarknetChainId.SN_MAIN
      : constants.StarknetChainId.SN_SEPOLIA,
  );
  const typedData = inboxKeyTypedData(account.address, chainId);
  const parts = stark.formatSignature(await account.signMessage(typedData));
  return deriveInboxKeyPairFromSignature(parts, chainId, account.address);
}
