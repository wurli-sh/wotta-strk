/** Wallet API 0.10.3 FELTs must not contain leading zeroes. */
export function toWalletApiFelt(value: string | bigint): `0x${string}` {
  let felt: bigint;
  try {
    felt = typeof value === "bigint" ? value : BigInt(value);
  } catch {
    throw new Error("invalid_felt");
  }
  if (felt < 0n || felt >= (1n << 252n)) throw new Error("invalid_felt");
  return `0x${felt.toString(16)}`;
}
