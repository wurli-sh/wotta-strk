import {
  asciiToBytes,
  bytesToAscii,
  bytesToHex,
  concatBytes,
  hexToBytes,
  readU16,
  readU32,
  readU256,
  u32ToBytes,
  u256ToBytes,
  u16ToBytes,
} from "../internal/bytes.ts";
import {
  decodeWottaHookV1,
  encodeWottaHookV1,
  type WottaHookV1,
  type WottaHookV1Input,
} from "./hook.ts";

export const CCTP_HOOK_WRAPPER_MAGIC = "CCTP" as const;
export const CCTP_HOOK_WRAPPER_VERSION = 1 as const;
export const CCTP_HOOK_WRAPPER_HEADER_BYTES = 7 as const;
export const CCTP_MESSAGE_V2_BODY_OFFSET = 148 as const;
export const CCTP_BURN_MESSAGE_V2_HOOK_OFFSET = 228 as const;
export const CCTP_STARKNET_DOMAIN = 25 as const;

export type CctpHookWrapperV1 = {
  magic: typeof CCTP_HOOK_WRAPPER_MAGIC;
  version: typeof CCTP_HOOK_WRAPPER_VERSION;
  hookLength: number;
  hook: WottaHookV1;
};

export type CircleCctpMessageV2 = {
  version: number;
  sourceDomain: number;
  destinationDomain: number;
  nonce: bigint;
  sender: string;
  recipient: string;
  destinationCaller: string;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  burn: {
    version: number;
    burnToken: string;
    mintRecipient: string;
    amount: bigint;
    messageSender: string;
    maxFee: bigint;
    feeExecuted: bigint;
    expirationBlock: bigint;
  };
  wrapper: CctpHookWrapperV1;
};

export function encodeCctpHookWrapperV1(
  input: WottaHookV1Input | Uint8Array,
): Uint8Array {
  const hookBytes = input instanceof Uint8Array ? input : encodeWottaHookV1(input);

  return concatBytes(
    asciiToBytes(CCTP_HOOK_WRAPPER_MAGIC),
    Uint8Array.of(CCTP_HOOK_WRAPPER_VERSION),
    u16ToBytes(hookBytes.length, "hookLength"),
    hookBytes,
  );
}

export function encodeCctpHookWrapperV1Hex(
  input: WottaHookV1Input | Uint8Array,
): string {
  return bytesToHex(encodeCctpHookWrapperV1(input));
}

export function decodeCctpHookWrapperV1(
  input: Uint8Array | string,
): CctpHookWrapperV1 {
  const bytes =
    typeof input === "string" ? hexToBytes(input, "CCTP hook wrapper") : input;

  if (bytes.length < CCTP_HOOK_WRAPPER_HEADER_BYTES) {
    throw new RangeError("CCTP hook wrapper is truncated");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = bytesToAscii(bytes.subarray(0, 4));
  const version = bytes[4];
  const hookLength = readU16(view, 5);
  const expectedLength = CCTP_HOOK_WRAPPER_HEADER_BYTES + hookLength;

  if (magic !== CCTP_HOOK_WRAPPER_MAGIC) {
    throw new Error("invalid CCTP hook wrapper magic");
  }

  if (version !== CCTP_HOOK_WRAPPER_VERSION) {
    throw new Error("unsupported CCTP hook wrapper version");
  }

  if (bytes.length !== expectedLength) {
    throw new RangeError("CCTP hook wrapper length mismatch");
  }

  const hookBytes = bytes.subarray(CCTP_HOOK_WRAPPER_HEADER_BYTES);

  return {
    magic: CCTP_HOOK_WRAPPER_MAGIC,
    version: CCTP_HOOK_WRAPPER_VERSION,
    hookLength,
    hook: decodeWottaHookV1(hookBytes),
  };
}

export function unwrapCctpHookPayload(input: Uint8Array | string): Uint8Array {
  const bytes =
    typeof input === "string" ? hexToBytes(input, "CCTP hook wrapper") : input;

  const wrapper = decodeCctpHookWrapperV1(bytes);
  return bytes.subarray(CCTP_HOOK_WRAPPER_HEADER_BYTES, CCTP_HOOK_WRAPPER_HEADER_BYTES + wrapper.hookLength);
}

/** Parse the byte-packed format signed by Circle Iris for CCTP V2. */
export function decodeCircleCctpMessageV2(input: Uint8Array | string): CircleCctpMessageV2 {
  const bytes = typeof input === "string" ? hexToBytes(input, "CCTP message") : input;
  const hookStart = CCTP_MESSAGE_V2_BODY_OFFSET + CCTP_BURN_MESSAGE_V2_HOOK_OFFSET;
  const expectedLength = hookStart + CCTP_HOOK_WRAPPER_HEADER_BYTES + 129;
  if (bytes.length !== expectedLength) {
    throw new RangeError(`Wotta CCTP message must be exactly ${expectedLength} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const burn = CCTP_MESSAGE_V2_BODY_OFFSET;
  return {
    version: readU32(view, 0),
    sourceDomain: readU32(view, 4),
    destinationDomain: readU32(view, 8),
    nonce: readU256(bytes, 12),
    sender: bytesToHex(bytes.subarray(44, 76)),
    recipient: bytesToHex(bytes.subarray(76, 108)),
    destinationCaller: bytesToHex(bytes.subarray(108, 140)),
    minFinalityThreshold: readU32(view, 140),
    finalityThresholdExecuted: readU32(view, 144),
    burn: {
      version: readU32(view, burn),
      burnToken: bytesToHex(bytes.subarray(burn + 4, burn + 36)),
      mintRecipient: bytesToHex(bytes.subarray(burn + 36, burn + 68)),
      amount: readU256(bytes, burn + 68),
      messageSender: bytesToHex(bytes.subarray(burn + 100, burn + 132)),
      maxFee: readU256(bytes, burn + 132),
      feeExecuted: readU256(bytes, burn + 164),
      expirationBlock: readU256(bytes, burn + 196),
    },
    wrapper: decodeCctpHookWrapperV1(bytes.subarray(hookStart)),
  };
}

/** Produces an exact Circle-format message for cross-language contract vectors. */
export function encodeCircleCctpMessageV2ForTest(input: {
  sourceDomain: number;
  tokenMessenger: string;
  router: string;
  amount: bigint;
  hook: WottaHookV1Input;
}): Uint8Array {
  const address = (value: string, label: string) => u256ToBytes(BigInt(value), label);
  return concatBytes(
    u32ToBytes(0, "version"),
    u32ToBytes(input.sourceDomain, "sourceDomain"),
    u32ToBytes(CCTP_STARKNET_DOMAIN, "destinationDomain"),
    u256ToBytes(9n, "nonce"),
    u256ToBytes(0x123n, "sender"),
    address(input.tokenMessenger, "tokenMessenger"),
    address(input.router, "destinationCaller"),
    u32ToBytes(0, "minFinalityThreshold"),
    u32ToBytes(0, "finalityThresholdExecuted"),
    u32ToBytes(0, "burnVersion"),
    u256ToBytes(0x456n, "burnToken"),
    address(input.router, "mintRecipient"),
    u256ToBytes(input.amount, "amount"),
    u256ToBytes(0x123n, "messageSender"),
    u256ToBytes(0n, "maxFee"),
    u256ToBytes(0n, "feeExecuted"),
    u256ToBytes(0n, "expirationBlock"),
    encodeCctpHookWrapperV1(input.hook),
  );
}
