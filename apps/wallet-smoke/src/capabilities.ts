import type { CapabilityReport } from "./types.ts";

export const REQUIRED_WALLET_API = "0.10.3" as const;

export const REQUIRED_METHODS = [
  "wallet_strk20Balances",
  "wallet_strk20PrepareInvoke",
  "wallet_strk20InvokeTransaction",
  "wallet_supportedWalletApi",
] as const;

export function assertWalletCapabilities(input: {
  supportedWalletApi: string[];
  walletVersion: string;
  featureNames: string[];
}): CapabilityReport {
  if (!input.featureNames.includes("starknet:walletApi")) {
    throw new Error(
      "Ready wallet missing starknet:walletApi; fail closed for STRK20 spike",
    );
  }
  if (!input.supportedWalletApi.includes(REQUIRED_WALLET_API)) {
    throw new Error(
      `Wallet API ${REQUIRED_WALLET_API} required; supported=${JSON.stringify(input.supportedWalletApi)}`,
    );
  }
  return {
    walletApiVersion: REQUIRED_WALLET_API,
    walletVersion: input.walletVersion,
    requiredMethods: [...REQUIRED_METHODS],
  };
}
