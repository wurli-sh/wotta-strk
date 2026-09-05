import { createStore } from "@starknet-io/get-starknet-discovery";
import { cairo, constants, walletV6, WalletAccountV6 } from "starknet";
import mainnetDeployment from "../../../../../deployments/mainnet.json";
import type { NetworkMode } from "@/lib/network-mode";

/**
 * Ready connection lifetimes (keep these separate):
 *
 * 1. Wallet extension session — Ready's own unlock / account selection.
 * 2. App network mode — Mainnet vs Sepolia product toggle (does NOT force reconnect).
 * 3. Privacy vault unlock — inbox secret decrypted for the active network in this tab.
 * 4. API wallet binding — `/v1/wallet/*` link for the active chain.
 *
 * `connectReady(mode)` caches one WalletAccountV6 per network for the page lifetime.
 * Reuse only validates the wallet chain (lazy switch if needed). A full
 * `WalletAccountV6.connect()` runs only on first use per network, concurrent
 * coalescing of in-flight connects, or `{ forceReconnect: true }`.
 *
 * Cache invalidation (`clearReadyConnections`):
 * - Sign-out / unlink Ready / clear vault (Account + PrivacyVaultProvider)
 * - Forced reconnect after a confirmed stale-session timeout (balance reveal)
 * - Never on app network toggle alone — Mainnet and Sepolia caches stay isolated
 */

const SEPOLIA_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export type ConnectedReady = {
  account: WalletAccountV6;
  address: string;
  walletName: string;
  supportedWalletApi: string[];
};

type ReadyRuntime = {
  connections: Partial<Record<NetworkMode, ConnectedReady>>;
  inFlight: Partial<Record<NetworkMode, Promise<ConnectedReady>>>;
  generation: number;
};

declare global {
  // Shared across routes and retained during client-side navigation/HMR.
  var __wottaReadyRuntime: ReadyRuntime | undefined;
}

const READY_CONNECT_TIMEOUT_MS = 30_000;

function readyRuntime(): ReadyRuntime {
  return globalThis.__wottaReadyRuntime ??= { connections: {}, inFlight: {}, generation: 0 };
}

export function clearReadyConnections(): void {
  const runtime = readyRuntime();
  runtime.generation += 1;
  runtime.connections = {};
  runtime.inFlight = {};
}

/** Read an existing session without connecting Ready or triggering a chain switch. */
export function peekReadyConnection(mode: NetworkMode): ConnectedReady | undefined {
  return readyRuntime().connections[mode];
}

function expectedChainId(mode: NetworkMode) {
  return mode === "mainnet"
    ? constants.StarknetChainId.SN_MAIN
    : constants.StarknetChainId.SN_SEPOLIA;
}

/**
 * The activation invoke is signed and broadcast through the selected Ready
 * account/provider. Keep its fee token network-scoped as well: a Mainnet
 * counterfactual account must never be activated from a testnet token config.
 */
export function activationFeeToken(mode: NetworkMode): string {
  if (mode === "testnet") return SEPOLIA_STRK;
  const token = mainnetDeployment.walletManagedPrivacy?.feeToken;
  if (!token || !/^0x[0-9a-f]+$/i.test(token)) {
    throw new Error("mainnet_strk_token_not_configured");
  }
  return token;
}

function findReadyWallet() {
  return createStore().getWallets().find((candidate) => /ready/i.test(candidate.name));
}

async function withReadyConnectTimeout<T>(request: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("ready_connection_unresponsive")), READY_CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

function isUndeployedAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /contract not found|code\D*20\b|\b20:\s*contract/i.test(message);
}

function undeployedAccountError(mode: NetworkMode): Error {
  return new Error(mode === "mainnet" ? "mainnet_wallet_not_deployed" : "testnet_wallet_not_deployed");
}

function isAccountAlreadyDeployedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ACCOUNT_ALREADY_DEPLOYED|\b115\b/.test(message);
}

type ReadyAccountDeploymentData = {
  address: string;
  class_hash: string;
  salt: string;
  calldata: string[];
};

export async function ensureReadyAccountDeployed(
  account: WalletAccountV6,
  mode: NetworkMode,
): Promise<void> {
  try {
    await account.provider.getClassHashAt(account.address);
    return;
  } catch (error) {
    if (!isUndeployedAccountError(error)) throw error;
  }

  const wallet = findReadyWallet();
  if (!wallet) throw undeployedAccountError(mode);

  let deployment: ReadyAccountDeploymentData;
  try {
    deployment = await walletV6.deploymentData(wallet as never);
  } catch (error) {
    if (isAccountAlreadyDeployedError(error)) return;
    throw undeployedAccountError(mode);
  }

  if (BigInt(deployment.address) !== BigInt(account.address)) {
    throw new Error("Connect the Ready account linked to this Wotta profile");
  }

  // WalletAccount uses an empty local signer, so Account.deployAccount() fails while
  // estimating/signing. Ready activates counterfactual accounts on the first approved
  // wallet invoke instead.
  const { low, high } = cairo.uint256(1n);
  const activated = await account.execute({
    contractAddress: activationFeeToken(mode),
    entrypoint: "transfer",
    calldata: [account.address, low.toString(), high.toString()],
  });
  await account.provider.waitForTransaction(activated.transaction_hash);

  try {
    await account.provider.getClassHashAt(account.address);
  } catch (error) {
    if (isUndeployedAccountError(error)) throw undeployedAccountError(mode);
    throw error;
  }
}

export async function connectReady(
  mode: NetworkMode = "testnet",
  options?: { forceReconnect?: boolean },
): Promise<ConnectedReady> {
  const rpcUrl = mode === "mainnet"
    ? process.env.NEXT_PUBLIC_STARKNET_MAINNET_RPC_URL
    : process.env.NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL ?? process.env.NEXT_PUBLIC_STARKNET_RPC_URL;
  if (!rpcUrl) throw new Error(`${mode === "mainnet" ? "Mainnet" : "Sepolia"} Starknet RPC is not configured`);
  const wallet = findReadyWallet();
  if (!wallet) throw new Error("Ready wallet was not found. Install or unlock Ready and retry");
  const runtime = readyRuntime();
  if (options?.forceReconnect) {
    runtime.generation += 1;
    delete runtime.connections[mode];
    delete runtime.inFlight[mode];
  }

  const cached = runtime.connections[mode];
  if (cached) {
    await ensureReadyChain(cached.account, mode);
    return cached;
  }
  const pending = runtime.inFlight[mode];
  if (pending) return pending;

  const generation = runtime.generation;
  const connecting = (async () => {
    const account = await withReadyConnectTimeout(
      WalletAccountV6.connect({ nodeUrl: rpcUrl }, wallet as never),
    );
    await ensureReadyChain(account, mode);
    const supportedWalletApi = (await walletV6.supportedWalletApi(wallet as never)).map(String);
    if (mode === "mainnet" && !supportedWalletApi.includes("0.10.3")) {
      throw new Error("Ready Wallet API 0.10.3 is required for mainnet privacy");
    }
    const connected = { account, address: account.address, walletName: wallet.name, supportedWalletApi };
    // An unlink/sign-out or forced reconnect may have invalidated this request
    // while the wallet UI was open. Never let that stale result repopulate cache.
    if (runtime.generation === generation) runtime.connections[mode] = connected;
    return connected;
  })();
  runtime.inFlight[mode] = connecting;
  try {
    return await connecting;
  } finally {
    if (runtime.inFlight[mode] === connecting) delete runtime.inFlight[mode];
  }
}
