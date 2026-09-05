import mainnetDeployment from "../../../../../deployments/mainnet.json";
import type { NetworkMode } from "@/lib/network-mode";

export type VesuEarnStatus = "pending" | "verified" | "withdraw_only";

export type VesuEarnConfig = {
  status: VesuEarnStatus;
  poolAddress: string;
  poolClassHash: string;
  factoryAddress: string;
  factoryClassHash: string;
  underlyingAddress: string;
  underlyingDecimals: 6;
  vTokenAddress: string;
  vTokenClassHash: string;
  vTokenDecimals: 18;
  anonymizerAddress: string;
  anonymizerClassHash: string;
  privacyPoolAddress: string;
  allowedDepositAmounts: readonly bigint[];
  marketPageUrl: string;
};

function isFelt(value: string): boolean {
  return /^0x[0-9a-f]+$/i.test(value);
}

export function sameFelt(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  try { return BigInt(left) === BigInt(right); } catch { return false; }
}

export function loadVesuEarn(): VesuEarnConfig {
  const earn = mainnetDeployment.vesuEarn;
  if (!earn || earn.network !== "SN_MAIN" || earn.protocolVersion !== "V2") {
    throw new Error("vesu_earn_not_configured");
  }
  return {
    ...earn,
    status: earn.status as VesuEarnStatus,
    underlyingDecimals: 6,
    vTokenDecimals: 18,
    allowedDepositAmounts: earn.allowedDepositAmounts.map(BigInt),
  };
}

export function hasLiveVesuAddresses(config = loadVesuEarn()): boolean {
  return [
    config.poolAddress,
    config.poolClassHash,
    config.factoryAddress,
    config.factoryClassHash,
    config.underlyingAddress,
    config.vTokenAddress,
    config.vTokenClassHash,
    config.anonymizerAddress,
    config.anonymizerClassHash,
    config.privacyPoolAddress,
  ].every(isFelt);
}

type DepositGate = {
  mode: NetworkMode;
  readyAddress?: string | null;
  linkedAddress?: string | null;
  amount?: bigint;
};

export function canDeposit(input: DepositGate, config = loadVesuEarn()): boolean {
  const privacyAllowlist = mainnetDeployment.walletManagedPrivacy.allowedActionAmounts.map(BigInt);
  return input.mode === "mainnet"
    && config.status === "verified"
    && hasLiveVesuAddresses(config)
    && sameFelt(input.readyAddress, input.linkedAddress)
    && input.amount !== undefined
    && input.amount > 0n
    && config.allowedDepositAmounts.includes(input.amount)
    && privacyAllowlist.includes(input.amount);
}

export function canWithdraw(input: Omit<DepositGate, "amount"> & { privateShares: bigint }, config = loadVesuEarn()): boolean {
  return input.mode === "mainnet"
    && (config.status === "verified" || config.status === "withdraw_only")
    && hasLiveVesuAddresses(config)
    && sameFelt(input.readyAddress, input.linkedAddress)
    && input.privateShares > 0n;
}

export function earnUnavailableReason(mode: NetworkMode, config = loadVesuEarn()): string {
  if (mode !== "mainnet") return "Vesu Earn is Mainnet-only. Switch to Mainnet to view availability.";
  if (config.status === "pending") return "Vesu Earn is being verified. Deposits and withdrawals stay disabled until the private route passes review and live smoke tests.";
  if (config.status === "withdraw_only") return "New deposits are paused. Existing private vUSDC can still be withdrawn.";
  return "Connect the Ready Mainnet account linked to this Wotta profile.";
}
