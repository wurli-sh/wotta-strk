import assert from "node:assert/strict";
import test from "node:test";
import {
  CCTP_HOOK_WRAPPER_HEADER_BYTES,
  PROTOCOL_FIXTURES,
  WOTTA_HOOK_BYTE_LENGTH,
  decodeCctpHookWrapperV1,
  decodeCircleCctpMessageV2,
  decodeWottaHookV1,
  encodeCctpHookWrapperV1Hex,
  encodeCircleCctpMessageV2ForTest,
  encodeWottaHookV1Hex,
  unwrapCctpHookPayload,
} from "../src/index.ts";

test("hook fixture encodes and decodes losslessly", () => {
  const encodedHex = encodeWottaHookV1Hex({
    magic: "WOTT",
    version: 1,
    intentId: PROTOCOL_FIXTURES.hook.intentId,
    denominationCode: PROTOCOL_FIXTURES.hook.denominationCode,
    escrowPool: PROTOCOL_FIXTURES.hook.escrowPool,
    claimHash: PROTOCOL_FIXTURES.hook.claimHash,
    publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
    expiresAt: BigInt(PROTOCOL_FIXTURES.hook.expiresAt),
    manifestVersion: PROTOCOL_FIXTURES.hook.manifestVersion,
  });

  assert.equal(encodedHex, PROTOCOL_FIXTURES.hook.encodedHex);

  const decoded = decodeWottaHookV1(encodedHex);
  assert.deepEqual(decoded, {
    magic: "WOTT",
    version: 1,
    intentId: PROTOCOL_FIXTURES.hook.intentId,
    denominationCode: PROTOCOL_FIXTURES.hook.denominationCode,
    escrowPool: PROTOCOL_FIXTURES.hook.escrowPool,
    claimHash: PROTOCOL_FIXTURES.hook.claimHash,
    publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
    expiresAt: BigInt(PROTOCOL_FIXTURES.hook.expiresAt),
    manifestVersion: PROTOCOL_FIXTURES.hook.manifestVersion,
  });
});

test("Circle CCTP V2 message codec preserves Wotta settlement bindings", () => {
  const message = encodeCircleCctpMessageV2ForTest({
    sourceDomain: 6,
    tokenMessenger: "0x4bdd",
    router: "0x7e5b",
    amount: 1_000_000n,
    hook: {
      intentId: PROTOCOL_FIXTURES.hook.intentId,
      denominationCode: 0,
      escrowPool: PROTOCOL_FIXTURES.hook.escrowPool,
      claimHash: PROTOCOL_FIXTURES.hook.claimHash,
      publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
      expiresAt: BigInt(PROTOCOL_FIXTURES.hook.expiresAt),
      manifestVersion: 1,
    },
  });
  const decoded = decodeCircleCctpMessageV2(message);
  assert.equal(message.length, 512);
  assert.equal(decoded.sourceDomain, 6);
  assert.equal(decoded.destinationDomain, 25);
  assert.equal(decoded.burn.amount, 1_000_000n);
  assert.equal(decoded.wrapper.hook.intentId, PROTOCOL_FIXTURES.hook.intentId);
});

test("CCTP wrapper embeds the hook fixture", () => {
  const wrapperHex = encodeCctpHookWrapperV1Hex(
    Uint8Array.from(Buffer.from(PROTOCOL_FIXTURES.hook.encodedHex.slice(2), "hex")),
  );

  assert.equal(wrapperHex, PROTOCOL_FIXTURES.cctp.encodedHex);

  const decoded = decodeCctpHookWrapperV1(wrapperHex);
  assert.equal(decoded.hookLength, WOTTA_HOOK_BYTE_LENGTH);
  assert.equal(decoded.hook.intentId, PROTOCOL_FIXTURES.hook.intentId);
  assert.equal(decoded.hook.claimHash, PROTOCOL_FIXTURES.hook.claimHash);

  const unwrapped = unwrapCctpHookPayload(wrapperHex);
  assert.equal(unwrapped.byteLength, WOTTA_HOOK_BYTE_LENGTH);
  assert.equal(
    Buffer.from(unwrapped).toString("hex"),
    PROTOCOL_FIXTURES.cctp.encodedHex.slice(2 + CCTP_HOOK_WRAPPER_HEADER_BYTES * 2),
  );
});
