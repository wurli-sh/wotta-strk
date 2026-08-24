import { createStore } from "@starknet-io/get-starknet-discovery";
import { constants, walletV6, WalletAccountV6 } from "starknet";
import type { NetworkMode } from "@/lib/network-mode";

export type ConnectedReady = {
  account: WalletAccountV6;
  address: string;
  walletName: string;
  supportedWalletApi: string[];
};

function expectedChainId(mode: NetworkMode) {
  return mode === "mainnet"
    ? constants.StarknetChainId.SN_MAIN
    : constants.StarknetChainId.SN_SEPOLIA;
}

function findReadyWallet() {
  return createStore().getWallets().find((candidate) => /ready/i.test(candidate.name));
}

async function readWalletChainId(wallet: unknown): Promise<string | undefined> {
  try {
    return await walletV6.requestChainId(wallet as never);
  } catch {
    return undefined;
  }
}

async function currentWalletChain(
  account: WalletAccountV6,
  wallet: unknown | undefined,
): Promise<string> {
  if (wallet) {
    const fromWallet = await readWalletChainId(wallet);
    if (fromWallet) return fromWallet;
  }
  return account.provider.getChainId();
}

export async function ensureReadyChain(
  account: WalletAccountV6,
  mode: NetworkMode,
): Promise<void> {
  const expected = expectedChainId(mode);
  const wallet = findReadyWallet();
  if ((await currentWalletChain(account, wallet)) === expected) return;

  if (!wallet) {
    throw new Error(mode === "mainnet" ? "ready_mainnet_network_mismatch" : "ready_testnet_network_mismatch");
  }

  const switched = await walletV6.switchStarknetChain(wallet as never, expected);
  if (!switched) {
    throw new Error(mode === "mainnet" ? "ready_mainnet_network_mismatch" : "ready_testnet_network_mismatch");
  }

  if ((await currentWalletChain(account, wallet)) !== expected) {
    throw new Error(mode === "mainnet" ? "ready_mainnet_network_mismatch" : "ready_testnet_network_mismatch");
  }
}

export async function ensureReadyAccountDeployed(
  account: WalletAccountV6,
  mode: NetworkMode,
): Promise<void> {
  try {
    await account.provider.getClassHashAt(account.address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/contract not found|code\D*20\b|\b20:\s*contract/i.test(message)) {
      throw new Error(mode === "mainnet" ? "mainnet_wallet_not_deployed" : "testnet_wallet_not_deployed");
    }
    throw error;
  }
}

export async function connectReady(mode: NetworkMode = "testnet"): Promise<ConnectedReady> {
  const rpcUrl = mode === "mainnet"
    ? process.env.NEXT_PUBLIC_STARKNET_MAINNET_RPC_URL
    : process.env.NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL;
  if (!rpcUrl) throw new Error(`${mode === "mainnet" ? "Mainnet" : "Sepolia"} Starknet RPC is not configured`);
  const wallet = findReadyWallet();
  if (!wallet) throw new Error("Ready wallet was not found. Install or unlock Ready and retry");
  const account = await WalletAccountV6.connect({ nodeUrl: rpcUrl }, wallet as never);
  await ensureReadyChain(account, mode);
  const supportedWalletApi = (await walletV6.supportedWalletApi(wallet as never)).map(String);
  if (mode === "mainnet" && !supportedWalletApi.includes("0.10.3")) {
    throw new Error("Ready Wallet API 0.10.3 is required for mainnet privacy");
  }
  return { account, address: account.address, walletName: wallet.name, supportedWalletApi };
}
