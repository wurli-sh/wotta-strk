export const DENS = [1n, 10n, 50n, 100n] as const;
export type Dens = (typeof DENS)[number];

export function densLabel(d: Dens | number | bigint): string {
  return `${d} USDC`;
}

export function isAllowedDenomination(value: unknown): value is Dens {
  try {
    const amount = BigInt(value as string | number | bigint);
    return DENS.some((denomination) => denomination === amount);
  } catch {
    return false;
  }
}
