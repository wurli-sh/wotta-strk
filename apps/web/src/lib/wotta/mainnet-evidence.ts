import type { MainnetPrivacyAction } from "./mainnet-privacy";

export type MainnetEvidenceAction = MainnetPrivacyAction | "shield-transfer";

export type MainnetEvidence = {
  action: MainnetEvidenceAction;
  transactionHash: string;
  destinationTxHash?: string;
  createdAt: string;
};

const STORAGE_KEY = "wotta:mainnet:evidence:v1";

export function readMainnetEvidence(): MainnetEvidence[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as MainnetEvidence[];
    return Array.isArray(value) ? value.filter((item) => item?.transactionHash?.startsWith("0x")) : [];
  } catch {
    return [];
  }
}

export function recordMainnetEvidence(
  action: MainnetEvidenceAction,
  transactionHash: string,
  destinationTxHash?: string,
): void {
  const next = [
    {
      action,
      transactionHash,
      ...(destinationTxHash ? { destinationTxHash } : {}),
      createdAt: new Date().toISOString(),
    },
    ...readMainnetEvidence().filter((item) => item.transactionHash !== transactionHash),
  ].slice(0, 20);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
