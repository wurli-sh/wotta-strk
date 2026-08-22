import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hash, shortString } from "starknet";

const WOTTA_CLAIM_V1 = "WOTTA_CLAIM_V1";
const WOTTA_REFUND_V1 = "WOTTA_REFUND_V1";
const SN_MAIN = "SN_MAIN";
const CHAIN_ID = shortString.encodeShortString(SN_MAIN);
const ESCROW_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const DENOMINATION = "1000000";
const DENOMINATION_CODE = 0;
const INTENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const CLAIM_SECRET =
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const REFUND_SECRET =
  "0x00f1e2d3c4b5a697887766554433221100ffeeddccbbaa998877665544332211";
const PUBLIC_REFUND_RECIPIENT =
  "0x011122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000";
const EXPIRES_AT = 1_735_689_600n;
const MANIFEST_VERSION = 1;

const outputPath = resolve(
  fileURLToPath(new URL("../src/fixtures/generated", import.meta.url)),
  "protocol-fixtures.json",
);

await mkdir(resolve(outputPath, ".."), { recursive: true });

const claimHash = computeHash(WOTTA_CLAIM_V1, CLAIM_SECRET);
const refundHash = computeHash(WOTTA_REFUND_V1, REFUND_SECRET);
const hookEncodedHex = bytesToHex(
  encodeHook({
    intentId: INTENT_ID,
    denominationCode: DENOMINATION_CODE,
    escrowPool: ESCROW_POOL,
    claimHash,
    publicRefundRecipient: PUBLIC_REFUND_RECIPIENT,
    expiresAt: EXPIRES_AT,
    manifestVersion: MANIFEST_VERSION,
  }),
);

const fixture = {
  version: 1,
  notes:
    "Static golden fixtures until Cairo-generated exports are wired into the build.",
  claim: {
    chainId: SN_MAIN,
    poolAddress: ESCROW_POOL,
    claimSecret: CLAIM_SECRET,
    refundSecret: REFUND_SECRET,
    claimHash,
    refundHash,
  },
  hook: {
    magic: "WOTT",
    version: 1,
    intentId: INTENT_ID,
    denomination: DENOMINATION,
    denominationCode: DENOMINATION_CODE,
    escrowPool: ESCROW_POOL,
    claimHash,
    publicRefundRecipient: PUBLIC_REFUND_RECIPIENT,
    expiresAt: EXPIRES_AT.toString(),
    manifestVersion: MANIFEST_VERSION,
    encodedHex: hookEncodedHex,
  },
  cctp: {
    encodedHex: bytesToHex(encodeCctpWrapper(hexToBytes(hookEncodedHex))),
  },
};

await writeFile(`${outputPath}`, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

function computeHash(tag, secret) {
  return toHex(
    hash.computePoseidonHashOnElements([
      BigInt(shortString.encodeShortString(tag)),
      BigInt(CHAIN_ID),
      BigInt(ESCROW_POOL),
      BigInt(secret),
    ]),
  );
}

function encodeHook(input) {
  return concatBytes(
    asciiToBytes("WOTT"),
    Uint8Array.of(1),
    uuidToBytes(input.intentId),
    u16ToBytes(input.denominationCode),
    toFixedBytes(input.escrowPool, 32),
    toFixedBytes(input.claimHash, 32),
    toFixedBytes(input.publicRefundRecipient, 32),
    u64ToBytes(input.expiresAt),
    u16ToBytes(input.manifestVersion),
  );
}

function encodeCctpWrapper(hookBytes) {
  return concatBytes(
    asciiToBytes("CCTP"),
    Uint8Array.of(1),
    u16ToBytes(hookBytes.length),
    hookBytes,
  );
}

function toHex(value) {
  return `0x${BigInt(value).toString(16)}`;
}

function asciiToBytes(value) {
  return Uint8Array.from(Buffer.from(value, "ascii"));
}

function hexToBytes(value) {
  return Uint8Array.from(Buffer.from(value.slice(2), "hex"));
}

function bytesToHex(value) {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function concatBytes(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16ToBytes(value) {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, false);
  return output;
}

function u64ToBytes(value) {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, BigInt(value), false);
  return output;
}

function toFixedBytes(value, byteLength) {
  const hex = BigInt(value).toString(16).padStart(byteLength * 2, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function uuidToBytes(value) {
  return Uint8Array.from(Buffer.from(value.replaceAll("-", ""), "hex"));
}
