import {
  asciiToBytes,
  bytesToAscii,
  bytesToHex,
  concatBytes,
  hexToBytes,
  readU16,
  readU64,
  u16ToBytes,
  u64ToBytes,
} from "../internal/bytes.ts";
import {
  bytesToUuid,
  normalizeHex32,
  toFixedBytes,
  uuidToBytes,
  type FeltLike,
} from "../internal/felt.ts";

export const WOTTA_HOOK_MAGIC = "WOTT" as const;
export const WOTTA_HOOK_VERSION = 1 as const;
export const WOTTA_HOOK_BYTE_LENGTH = 129 as const;

export type WottaHookV1 = {
  magic: typeof WOTTA_HOOK_MAGIC;
  version: typeof WOTTA_HOOK_VERSION;
  intentId: string;
  denominationCode: number;
  escrowPool: string;
  claimHash: string;
  publicRefundRecipient: string;
  expiresAt: bigint;
  manifestVersion: number;
};

export type WottaHookV1Input = {
  magic?: typeof WOTTA_HOOK_MAGIC;
  version?: typeof WOTTA_HOOK_VERSION;
  intentId: string;
  denominationCode: number;
  escrowPool: FeltLike;
  claimHash: FeltLike;
  publicRefundRecipient: FeltLike;
  expiresAt: bigint | number;
  manifestVersion: number;
};

export function encodeWottaHookV1(input: WottaHookV1Input): Uint8Array {
  const normalized = normalizeWottaHookV1Input(input);

  return concatBytes(
    asciiToBytes(normalized.magic),
    Uint8Array.of(normalized.version),
    uuidToBytes(normalized.intentId),
    u16ToBytes(normalized.denominationCode, "denominationCode"),
    toFixedBytes(normalized.escrowPool, 32, "escrowPool"),
    toFixedBytes(normalized.claimHash, 32, "claimHash"),
    toFixedBytes(normalized.publicRefundRecipient, 32, "publicRefundRecipient"),
    u64ToBytes(normalized.expiresAt, "expiresAt"),
    u16ToBytes(normalized.manifestVersion, "manifestVersion"),
  );
}

export function encodeWottaHookV1Hex(input: WottaHookV1Input): string {
  return bytesToHex(encodeWottaHookV1(input));
}

export function decodeWottaHookV1(input: Uint8Array | string): WottaHookV1 {
  const bytes =
    typeof input === "string" ? hexToBytes(input, "hook payload") : input;

  if (bytes.length !== WOTTA_HOOK_BYTE_LENGTH) {
    throw new RangeError(
      `hook payload must be exactly ${WOTTA_HOOK_BYTE_LENGTH} bytes`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = bytesToAscii(bytes.subarray(0, 4));
  const version = bytes[4];

  if (magic !== WOTTA_HOOK_MAGIC) {
    throw new Error("invalid hook magic");
  }

  if (version !== WOTTA_HOOK_VERSION) {
    throw new Error("unsupported hook version");
  }

  const intentId = bytesToUuid(bytes.subarray(5, 21));
  const denominationCode = readU16(view, 21);
  const escrowPool = normalizeHex32(bytesToHex(bytes.subarray(23, 55)), "escrowPool");
  const claimHash = normalizeHex32(bytesToHex(bytes.subarray(55, 87)), "claimHash");
  const publicRefundRecipient = normalizeHex32(
    bytesToHex(bytes.subarray(87, 119)),
    "publicRefundRecipient",
  );
  const expiresAt = readU64(view, 119);
  const manifestVersion = readU16(view, 127);

  return {
    magic: WOTTA_HOOK_MAGIC,
    version: WOTTA_HOOK_VERSION,
    intentId,
    denominationCode,
    escrowPool,
    claimHash,
    publicRefundRecipient,
    expiresAt,
    manifestVersion,
  };
}

function normalizeWottaHookV1Input(input: WottaHookV1Input): Required<WottaHookV1Input> {
  const magic = input.magic ?? WOTTA_HOOK_MAGIC;
  const version = input.version ?? WOTTA_HOOK_VERSION;

  if (magic !== WOTTA_HOOK_MAGIC) {
    throw new Error("invalid hook magic");
  }

  if (version !== WOTTA_HOOK_VERSION) {
    throw new Error("unsupported hook version");
  }

  return {
    ...input,
    magic,
    version,
  };
}
