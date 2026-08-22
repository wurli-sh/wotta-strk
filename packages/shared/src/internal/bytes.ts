export function hexToBytes(value: string, label: string): Uint8Array {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new TypeError(`${label} must be an even-length 0x-prefixed hex string`);
  }

  return Uint8Array.from(Buffer.from(normalized.slice(2), "hex"));
}

export function bytesToHex(value: Uint8Array): string {
  return `0x${Buffer.from(value).toString("hex")}`;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

export function asciiToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "ascii"));
}

export function bytesToAscii(value: Uint8Array): string {
  return Buffer.from(value).toString("ascii");
}

export function u16ToBytes(value: number, label: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${label} must fit in u16`);
  }

  const output = new Uint8Array(2);
  const view = new DataView(output.buffer);
  view.setUint16(0, value, false);
  return output;
}

export function u32ToBytes(value: number, label: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${label} must fit in u32`);
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

export function u256ToBytes(value: bigint | number, label: string): Uint8Array {
  const normalized = typeof value === "bigint" ? value : BigInt(value);
  if (normalized < 0n || normalized >= (1n << 256n)) {
    throw new RangeError(`${label} must fit in u256`);
  }
  const hex = normalized.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

export function u64ToBytes(value: bigint | number, label: string): Uint8Array {
  const normalized =
    typeof value === "bigint"
      ? value
      : Number.isSafeInteger(value) && value >= 0
        ? BigInt(value)
        : null;

  if (normalized === null || normalized > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`${label} must fit in u64`);
  }

  const output = new Uint8Array(8);
  const view = new DataView(output.buffer);
  view.setBigUint64(0, normalized, false);
  return output;
}

export function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

export function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export function readU256(bytes: Uint8Array, offset: number): bigint {
  return BigInt(`0x${Buffer.from(bytes.subarray(offset, offset + 32)).toString("hex")}`);
}

export function readU64(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, false);
}
