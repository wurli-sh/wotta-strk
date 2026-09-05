import { sameFelt } from "./config";

export type VesuLedgerEntry = {
  readyAddress: string;
  vTokenAddress: string;
  costBasisAssets: string;
  firstDepositAt: string;
};

const PREFIX = "wotta:vesu-ledger:v1";

function key(readyAddress: string, vTokenAddress: string): string {
  return `${PREFIX}:${BigInt(readyAddress).toString(16)}:${BigInt(vTokenAddress).toString(16)}`;
}

export function readLedger(readyAddress: string, vTokenAddress: string): VesuLedgerEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key(readyAddress, vTokenAddress)) ?? "null") as VesuLedgerEntry | null;
    if (!parsed || !sameFelt(parsed.readyAddress, readyAddress) || !sameFelt(parsed.vTokenAddress, vTokenAddress)) return null;
    BigInt(parsed.costBasisAssets);
    return parsed;
  } catch { return null; }
}

export function recordDeposit(readyAddress: string, vTokenAddress: string, assets: bigint, now = new Date()): VesuLedgerEntry {
  if (assets <= 0n) throw new Error("invalid_vesu_deposit_amount");
  const previous = readLedger(readyAddress, vTokenAddress);
  const next = {
    readyAddress,
    vTokenAddress,
    costBasisAssets: (BigInt(previous?.costBasisAssets ?? "0") + assets).toString(),
    firstDepositAt: previous?.firstDepositAt ?? now.toISOString(),
  };
  window.localStorage.setItem(key(readyAddress, vTokenAddress), JSON.stringify(next));
  return next;
}

export function recordRedeem(readyAddress: string, vTokenAddress: string, sharesBefore: bigint, sharesAfter: bigint): VesuLedgerEntry | null {
  const previous = readLedger(readyAddress, vTokenAddress);
  if (!previous) return null;
  if (sharesBefore <= 0n || sharesAfter < 0n || sharesAfter > sharesBefore) throw new Error("invalid_vesu_share_amount");
  if (sharesAfter === 0n) {
    window.localStorage.removeItem(key(readyAddress, vTokenAddress));
    return null;
  }
  const next = { ...previous, costBasisAssets: ((BigInt(previous.costBasisAssets) * sharesAfter) / sharesBefore).toString() };
  window.localStorage.setItem(key(readyAddress, vTokenAddress), JSON.stringify(next));
  return next;
}
