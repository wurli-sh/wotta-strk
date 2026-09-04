import {
  Account,
  RpcProvider,
  Signer,
  SignerInterface,
  type Call,
  type CompiledContract,
  type CompiledSierraCasm,
  type DeclareSignerDetails,
  type DeployAccountSignerDetails,
  type InvocationsSignerDetails,
  type ResourceBoundsBN,
  type Signature,
  type TypedData,
} from "starknet";
import { STARKNET_MAINNET_CHAIN_ID } from "./mainnet-constants.ts";

/** 20% overhead on each resource-bound component (amount and price). */
export const DECLARE_RESOURCE_BOUNDS_OVERHEAD = {
  l1_gas: { max_amount: 20, max_price_per_unit: 20 },
  l1_data_gas: { max_amount: 20, max_price_per_unit: 20 },
  l2_gas: { max_amount: 20, max_price_per_unit: 20 },
} as const;

/** Live SN_MAIN router declare bound was ~45.14 STRK; ceiling keeps ~10% headroom. */
export const ROUTER_DECLARE_CEILING_STRK = 50n;
export const ESCROW_DECLARE_CEILING_STRK = 35n;
export const STRK_FRI = 1_000_000_000_000_000_000n;

/** Argent X 5.16.3. Its guardian-enabled accounts require a 4-felt signature. */
export const ARGENT_X_V5163_CLASS_HASH =
  "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

function concatArgentSignatures(owner: Signature, guardian: Signature): Signature {
  if (!Array.isArray(owner) || !Array.isArray(guardian)) {
    throw new Error("mainnet_blocked:argent_stark_signature_required");
  }
  return [...owner, ...guardian];
}

/**
 * Argent's concise guardian signature is `[owner_r, owner_s, guardian_r,
 * guardian_s]`. starknet.js intentionally knows nothing about account-specific
 * signature encodings, so compose two standard Stark-curve signatures here.
 */
export class ArgentOwnerGuardianSigner extends SignerInterface {
  private readonly owner: Signer;
  private readonly guardian: Signer;

  constructor(owner: Signer, guardian: Signer) {
    super();
    this.owner = owner;
    this.guardian = guardian;
  }

  getPubKey(): Promise<string> {
    return this.owner.getPubKey();
  }

  async signMessage(typedData: TypedData, accountAddress: string): Promise<Signature> {
    return concatArgentSignatures(
      await this.owner.signMessage(typedData, accountAddress),
      await this.guardian.signMessage(typedData, accountAddress),
    );
  }

  async signTransaction(calls: Call[], details: InvocationsSignerDetails): Promise<Signature> {
    return concatArgentSignatures(
      await this.owner.signTransaction(calls, details),
      await this.guardian.signTransaction(calls, details),
    );
  }

  async signDeployAccountTransaction(details: DeployAccountSignerDetails): Promise<Signature> {
    return concatArgentSignatures(
      await this.owner.signDeployAccountTransaction(details),
      await this.guardian.signDeployAccountTransaction(details),
    );
  }

  async signDeclareTransaction(details: DeclareSignerDetails): Promise<Signature> {
    return concatArgentSignatures(
      await this.owner.signDeclareTransaction(details),
      await this.guardian.signDeclareTransaction(details),
    );
  }
}

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
  const ownerSigner = new Signer(normalizeMainnetPrivateKey(privateKey));
  const guardianKey = process.env.STARKNET_MAINNET_DEPLOYER_GUARDIAN_PRIVATE_KEY?.trim();
  const signer = guardianKey
    ? new ArgentOwnerGuardianSigner(ownerSigner, new Signer(normalizeMainnetPrivateKey(guardianKey)))
    : ownerSigner;
  const provider = new RpcProvider({
    nodeUrl,
    resourceBoundsOverhead: DECLARE_RESOURCE_BOUNDS_OVERHEAD,
  });
  return new Account({
    provider,
    signer,
    address,
  });
}

/** Fail before submission unless the configured key material matches Argent's on-chain guardian. */
export async function assertMainnetDeployerSignerReady(account: Account): Promise<void> {
  const classHash = await account.provider.getClassHashAt(account.address);
  if (BigInt(classHash) !== BigInt(ARGENT_X_V5163_CLASS_HASH)) return;
  const guardianResult = await account.provider.callContract({
    contractAddress: account.address,
    entrypoint: "get_guardian",
    calldata: [],
  });
  const guardianPubKey = guardianResult[0] ?? "0x0";
  if (BigInt(guardianPubKey) === 0n) return;
  const guardianKey = process.env.STARKNET_MAINNET_DEPLOYER_GUARDIAN_PRIVATE_KEY?.trim();
  if (!guardianKey) throw new Error("mainnet_blocked:argent_guardian_private_key_required");
  const configuredPubKey = await new Signer(normalizeMainnetPrivateKey(guardianKey)).getPubKey();
  if (BigInt(configuredPubKey) !== BigInt(guardianPubKey)) {
    throw new Error("mainnet_blocked:argent_guardian_key_mismatch");
  }
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
