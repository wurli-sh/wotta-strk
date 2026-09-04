import {
  Account,
  RpcProvider,
  Signer,
  type CompiledContract,
  type CompiledSierraCasm,
  type ResourceBoundsBN,
} from "starknet";
import { STARKNET_MAINNET_CHAIN_ID } from "./mainnet-constants.ts";

/** 20% overhead on each resource-bound component (amount and price). */
export const DECLARE_RESOURCE_BOUNDS_OVERHEAD = {
  l1_gas: { max_amount: 20, max_price_per_unit: 20 },
  l1_data_gas: { max_amount: 20, max_price_per_unit: 20 },
  l2_gas: { max_amount: 20, max_price_per_unit: 20 },
} as const;

export const ROUTER_DECLARE_CEILING_STRK = 45n;
export const ESCROW_DECLARE_CEILING_STRK = 35n;
export const STRK_FRI = 1_000_000_000_000_000_000n;

export function requireMainnetRpcUrl(): string {
  const rpcUrl = process.env.STARKNET_MAINNET_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("mainnet_blocked:missing STARKNET_MAINNET_RPC_URL");
  return rpcUrl;
}

export async function assertProviderIsMainnet(provider: RpcProvider): Promise<void> {
  const chainId = await provider.getChainId();
  if (chainId !== STARKNET_MAINNET_CHAIN_ID) {
    throw new Error(`wrong_network: expected SN_MAIN, got ${chainId}`);
  }
}

export function normalizeMainnetPrivateKey(value: string): string {
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(normalized)) return normalized;
  throw new Error("invalid STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY");
}

export function createMainnetDeployerAccount(nodeUrl: string): Account {
  const address = process.env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim();
  const privateKey = process.env.STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!address || !privateKey) throw new Error("mainnet_blocked:dedicated_deployer_credentials_missing");
  const provider = new RpcProvider({
    nodeUrl,
    resourceBoundsOverhead: DECLARE_RESOURCE_BOUNDS_OVERHEAD,
  });
  return new Account({
    provider,
    signer: new Signer(normalizeMainnetPrivateKey(privateKey)),
    address,
  });
}

export function overallFeeStrk(overallFeeFri: bigint): number {
  return Number(overallFeeFri) / Number(STRK_FRI);
}

export async function estimateDeclareBoundStrk(
  account: Account,
  artifact: { contract: CompiledContract; casm: CompiledSierraCasm },
): Promise<{ overallFeeFri: bigint; resourceBounds: ResourceBoundsBN }> {
  const fee = await account.estimateDeclareFee(
    { contract: artifact.contract, casm: artifact.casm },
    { tip: 0n },
  );
  return {
    overallFeeFri: maxFeeForBounds(fee.resourceBounds),
    resourceBounds: fee.resourceBounds,
  };
}

export function maxFeeForBounds(bounds: ResourceBoundsBN): bigint {
  return bounds.l1_gas.max_amount * bounds.l1_gas.max_price_per_unit
    + bounds.l1_data_gas.max_amount * bounds.l1_data_gas.max_price_per_unit
    + bounds.l2_gas.max_amount * bounds.l2_gas.max_price_per_unit;
}

const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export async function deployerStrkBalance(account: Account): Promise<bigint> {
  const result = await account.provider.callContract({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "balanceOf",
    calldata: [account.address],
  });
  return BigInt(result[0] ?? 0) + (BigInt(result[1] ?? 0) << 128n);
}

export function assertBalanceCoversBounds(balance: bigint, bounds: readonly bigint[]): void {
  const required = bounds.reduce((total, bound) => total + bound, 0n);
  if (balance < required) {
    throw new Error(
      `mainnet_blocked:deployer_balance_below_declare_bounds:${overallFeeStrk(balance).toFixed(4)}_STRK<${overallFeeStrk(required).toFixed(4)}_STRK`,
    );
  }
}

export function assertDeclareWithinCeiling(
  label: "router" | "escrow",
  overallFeeFri: bigint,
): void {
  const ceiling = label === "router" ? ROUTER_DECLARE_CEILING_STRK : ESCROW_DECLARE_CEILING_STRK;
  const strk = overallFeeFri / STRK_FRI;
  const rem = overallFeeFri % STRK_FRI;
  // Abort if bound exceeds absolute ceiling (ceil if any fractional FRI remains).
  const boundStrk = rem === 0n ? strk : strk + 1n;
  if (boundStrk > ceiling) {
    throw new Error(
      `mainnet_blocked:${label}_declare_bound_exceeds_ceiling:${overallFeeStrk(overallFeeFri).toFixed(4)}_STRK>${ceiling}_STRK`,
    );
  }
}
