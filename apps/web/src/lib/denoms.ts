export const DENS = [1n, 10n, 50n, 100n] as const;
/** Mainnet pilot: only deployed/approved Wotta escrow dens (0.1 and 1 USDC). */
export const MAINNET_DENS = ["0.1", 1n] as const;
/** Mainnet amount row: live dens + undeployed dens shown as soon. */
export const MAINNET_DISPLAY_DENS = ["0.1", 1n, 10n, 50n, 100n] as const;
export type TestnetDens = (typeof DENS)[number];
export type Dens = (typeof MAINNET_DISPLAY_DENS)[number];

export function densLabel(d: Dens | number | bigint): string {
  return `${d} USDC`;
}

export function denominationBaseUnits(value: Dens): bigint {
  if (value === "0.1") return 100_000n;
  return value * 1_000_000n;
}

export function isMainnetDenomination(value: Dens): value is (typeof MAINNET_DENS)[number] {
  return MAINNET_DENS.some((denomination) => denomination === value);
}

export function coerceMainnetDenomination(value: Dens): (typeof MAINNET_DENS)[number] {
  return isMainnetDenomination(value) ? value : "0.1";
}

export function isAllowedDenomination(value: unknown): value is TestnetDens {
  try {
    const amount = BigInt(value as string | number | bigint);
    return DENS.some((denomination) => denomination === amount);
  } catch {
    return false;
  }
}
