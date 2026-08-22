import { createStore } from "@starknet-io/get-starknet-discovery";
import { constants, WalletAccountV6 } from "starknet";

export type ConnectedReady = {
  account: WalletAccountV6;
  address: string;
  walletName: string;
};

export async function connectReady(): Promise<ConnectedReady> {
  const rpcUrl = process.env.NEXT_PUBLIC_STARKNET_RPC_URL;
  if (!rpcUrl) throw new Error("Starknet Sepolia RPC is not configured");
  const wallet = createStore().getWallets().find((candidate) => /ready/i.test(candidate.name));
  if (!wallet) throw new Error("Ready wallet was not found. Install or unlock Ready and retry");
  const account = await WalletAccountV6.connect({ nodeUrl: rpcUrl }, wallet as never);
  await account.switchStarknetChain(constants.StarknetChainId.SN_SEPOLIA);
  return { account, address: account.address, walletName: wallet.name };
}
