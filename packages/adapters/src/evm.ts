import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { CIRCLE_ROUTE_REGISTRY, type CircleEnvironment, type EvmCctpBurnPlan } from "./index.ts";

type Eip1193 = { request(input: { method: string; params?: unknown[] }): Promise<unknown> };
const erc20 = parseAbi([
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const CHAINS: Record<number, { chainName: string; nativeCurrency: { name: string; symbol: string; decimals: number }; rpcUrls: string[]; blockExplorerUrls: string[] }> = {
  // Testnet
  11155111: { chainName: "Ethereum Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"], blockExplorerUrls: ["https://sepolia.etherscan.io"] },
  421614: { chainName: "Arbitrum Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"], blockExplorerUrls: ["https://sepolia.arbiscan.io"] },
  84532: { chainName: "Base Sepolia", nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://sepolia.base.org"], blockExplorerUrls: ["https://sepolia.basescan.org"] },
  // Mainnet
  8453: { chainName: "Base", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] },
};

export async function executeEvmCctpBurn(input: {
  plan: EvmCctpBurnPlan;
  provider?: Eip1193;
  expectedSourceAccount?: string;
  onStage?: (stage: "connecting" | "approving" | "burning" | "confirming") => void;
}): Promise<{ txHash: string; approvalTxHash?: string; sourceAccount: string }> {
  const provider = input.provider ?? injectedProvider();
  const chainId = input.plan.route.chainId;
  if (!chainId) throw new Error("EVM route chain ID is missing");
  input.onStage?.("connecting");
  await ensureChain(provider, chainId);
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  const sourceAccount = accounts[0];
  if (!sourceAccount || !/^0x[0-9a-f]{40}$/i.test(sourceAccount)) throw new Error("No EVM account is connected");
  if (input.expectedSourceAccount && sourceAccount.toLowerCase() !== input.expectedSourceAccount.toLowerCase()) {
    throw new Error("EVM account changed; request a new quote");
  }
  const amount = decodeApproveAmount(input.plan.calls[0].data);
  const sourceAddress = sourceAccount as `0x${string}`;
  const messengerAddress = input.plan.route.tokenMessenger as `0x${string}`;
  const usdc = input.plan.route.usdc as `0x${string}`;
  const balance = await readUint(provider, usdc, "balanceOf", [sourceAddress]);
  if (balance < amount) throw new Error("Insufficient source-chain USDC balance");
  let allowance = await readUint(provider, usdc, "allowance", [sourceAddress, messengerAddress]);
  let approvalTxHash: string | undefined;
  if (allowance < amount) {
    input.onStage?.("approving");
    // Circle FiatToken V2.1 rejects non-zero→non-zero approve; reset first when needed.
    if (allowance > 0n) {
      await simulateSendWait(provider, sourceAccount, {
        to: usdc,
        value: "0x0",
        data: encodeFunctionData({ abi: erc20, functionName: "approve", args: [messengerAddress, 0n] }),
      });
      allowance = await waitForAllowance(provider, usdc, sourceAddress, messengerAddress, (value) => value === 0n);
    }
    approvalTxHash = await simulateSendWait(provider, sourceAccount, input.plan.calls[0]);
    const refreshed = await waitForAllowance(provider, usdc, sourceAddress, messengerAddress, (value) => value >= amount);
    if (refreshed < amount) {
      throw new Error(
        "USDC approval did not cover the CCTP burn. In MetaMask, set the spending cap to the full quoted amount (or Max), then try again.",
      );
    }
  }
  input.onStage?.("burning");
  const txHash = await simulateSendWait(provider, sourceAccount, input.plan.calls[1], () => input.onStage?.("confirming"));
  return approvalTxHash ? { txHash, approvalTxHash, sourceAccount } : { txHash, sourceAccount };
}

export async function connectEvmSource(
  routeId: "ethereum" | "arbitrum" | "base",
  environment: CircleEnvironment,
  provider: Eip1193 = injectedProvider(),
) {
  const route = CIRCLE_ROUTE_REGISTRY[environment][routeId];
  const chainId = route?.chainId;
  if (!route || route.family !== "evm" || !chainId) {
    throw new Error(`Route "${routeId}" is not configured for the "${environment}" environment`);
  }
  await ensureChain(provider, chainId);
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0];
  if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("No EVM account is connected");
  return address;
}

function injectedProvider(): Eip1193 {
  const value = (globalThis as typeof globalThis & { ethereum?: Eip1193 }).ethereum;
  if (!value) throw new Error("Install or unlock an EVM wallet");
  return value;
}

async function ensureChain(provider: Eip1193, chainId: number) {
  const expected = `0x${chainId.toString(16)}`;
  if (String(await provider.request({ method: "eth_chainId" })).toLowerCase() === expected) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expected }] });
  } catch {
    const config = CHAINS[chainId];
    if (!config) throw new Error("Unsupported EVM source chain");
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: expected, ...config }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: expected }] });
  }
}

async function readUint(provider: Eip1193, token: string, functionName: "balanceOf" | "allowance", args: `0x${string}`[]) {
  const data = encodeFunctionData({ abi: erc20, functionName, args: args as never });
  const raw = await provider.request({ method: "eth_call", params: [{ to: token, data }, "latest"] }) as Hex;
  return decodeFunctionResult({ abi: erc20, functionName, data: raw });
}

function decodeApproveAmount(data: Hex): bigint {
  const decoded = decodeFunctionData({ abi: erc20, data });
  if (decoded.functionName !== "approve") throw new Error("Invalid approval calldata");
  const amount = decoded.args[1];
  if (typeof amount !== "bigint" || amount <= 0n) throw new Error("Invalid approval amount");
  return amount;
}

async function waitForAllowance(
  provider: Eip1193,
  token: `0x${string}`,
  owner: `0x${string}`,
  spender: `0x${string}`,
  ready: (value: bigint) => boolean,
) {
  let latest = await readUint(provider, token, "allowance", [owner, spender]);
  for (let attempt = 0; attempt < 15 && !ready(latest); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    latest = await readUint(provider, token, "allowance", [owner, spender]);
  }
  return latest;
}

async function simulateSendWait(provider: Eip1193, from: string, call: { to: string; data: string; value: string }, beforeWait?: () => void) {
  await provider.request({ method: "eth_estimateGas", params: [{ from, ...call }] });
  const hash = String(await provider.request({ method: "eth_sendTransaction", params: [{ from, ...call }] }));
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("Wallet returned an invalid transaction hash");
  beforeWait?.();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("Source transaction reverted");
      return hash;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the source transaction");
}
