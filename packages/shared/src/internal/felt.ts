import { shortString } from "starknet";

const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;
const DECIMAL_PATTERN = /^[0-9]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FeltLike = bigint | number | string;

export function toCanonicalHex(value: FeltLike): string {
  const felt = normalizeFelt(value);
  return `0x${felt.toString(16)}`;
}

export function normalizeFelt(value: FeltLike): bigint {
  if (typeof value === "bigint") {
    assertNonNegative(value, "felt");
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("felt number must be a non-negative safe integer");
    }

    return BigInt(value);
  }

  if (HEX_PATTERN.test(value)) {
    return BigInt(value.toLowerCase());
  }

  if (DECIMAL_PATTERN.test(value)) {
    return BigInt(value);
  }

  throw new TypeError("felt strings must be hex or decimal");
}

export function normalizeHex32(value: FeltLike, label: string): string {
  const felt = toFixedBytes(value, 32, label);
  return `0x${Buffer.from(felt).toString("hex")}`;
}

export function toFixedBytes(
  value: FeltLike,
  byteLength: number,
  label: string,
): Uint8Array {
  const felt = normalizeFelt(value);
  const maxValue = 1n << BigInt(byteLength * 8);

  if (felt >= maxValue) {
    throw new RangeError(`${label} exceeds ${byteLength} bytes`);
  }

  const hex = felt.toString(16).padStart(byteLength * 2, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function uuidToBytes(value: string): Uint8Array {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError("intentId must be a UUID");
  }

  return Uint8Array.from(
    Buffer.from(value.replaceAll("-", "").toLowerCase(), "hex"),
  );
}

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new RangeError("UUID byte length must be exactly 16");
  }

  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function shortStringToFelt(value: string): bigint {
  return BigInt(shortString.encodeShortString(value));
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new RangeError(`${label} must be non-negative`);
  }
}
