import { createStore } from "@starknet-io/get-starknet-discovery";
import { constants, WalletAccountV6 } from "starknet";
import type { SmokeConfig } from "./config.ts";
import { detectCapabilities, type ConnectedWallet } from "./flow.ts";

export async function connectReady(
  config: SmokeConfig,
): Promise<ConnectedWallet> {
  const store = createStore();
  const wallets = store.getWallets();
  const ready = wallets.find((wallet) => /ready/i.test(wallet.name));
  if (!ready) {
    throw new Error(
      "Ready wallet not discovered. Install Ready and retry; no wallet fallback is allowed for this smoke.",
    );
  }
  const account = await WalletAccountV6.connect(
    { nodeUrl: config.rpcUrl },
    ready as never,
  );
  await account.switchStarknetChain(
    config.chainId === "SN_MAIN"
      ? constants.StarknetChainId.SN_MAIN
      : constants.StarknetChainId.SN_SEPOLIA,
  );
  const detection = await detectCapabilities(account, ready as never);
  return {
    account,
    address: account.address,
    walletId: ready.name,
    walletVersion: detection.walletVersion,
    supportedWalletApi: detection.supportedWalletApi,
    capabilities: detection.capabilities,
  };
}
