/** Integer-only USDC formatter (6 decimals). Never use Number for money. */
export function formatUsdc(value: bigint | string | number): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount < 0n) throw new Error("invalid_usdc_amount");
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function parseUsdcInput(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("Enter a valid USDC amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
