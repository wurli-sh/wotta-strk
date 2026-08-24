export const DENS = [1n, 10n, 50n, 100n] as const;
export const MAINNET_DENS = ["0.1", ...DENS] as const;
export type TestnetDens = (typeof DENS)[number];
export type Dens = (typeof MAINNET_DENS)[number];

export function densLabel(d: Dens | number | bigint): string {
  return `${d} USDC`;
}

export function denominationBaseUnits(value: Dens): bigint {
  if (value === "0.1") return 100_000n;
  return value * 1_000_000n;
}

export function isAllowedDenomination(value: unknown): value is TestnetDens {
  try {
    const amount = BigInt(value as string | number | bigint);
    return DENS.some((denomination) => denomination === amount);
  } catch {
    return false;
  }
}
