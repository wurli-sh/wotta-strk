import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_FIXTURES,
  decodeCctpHookWrapperV1,
  decodeCircleCctpMessageV2,
  decodeWottaHookV1,
  encodeCircleCctpMessageV2ForTest,
} from "../src/index.ts";

function fixtureBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
}

test("hook decoder rejects truncation and wrong magic", () => {
  const hookBytes = fixtureBytes(PROTOCOL_FIXTURES.hook.encodedHex);

  assert.throws(() => decodeWottaHookV1(hookBytes.subarray(0, hookBytes.length - 1)), {
    message: /exactly 129 bytes/,
  });

  const wrongMagic = hookBytes.slice();
  wrongMagic[0] = 0x58;
  assert.throws(() => decodeWottaHookV1(wrongMagic), /invalid hook magic/);
});

test("CCTP wrapper decoder rejects truncation and trailing data", () => {
  const wrapperBytes = fixtureBytes(PROTOCOL_FIXTURES.cctp.encodedHex);

  assert.throws(
    () => decodeCctpHookWrapperV1(wrapperBytes.subarray(0, wrapperBytes.length - 1)),
    /length mismatch/,
  );

  const withTrailingByte = new Uint8Array(wrapperBytes.length + 1);
  withTrailingByte.set(wrapperBytes);
  withTrailingByte[withTrailingByte.length - 1] = 0xff;

  assert.throws(
    () => decodeCctpHookWrapperV1(withTrailingByte),
    /length mismatch/,
  );
});

test("hook decoder rejects unsupported version", () => {
  const hookBytes = fixtureBytes(PROTOCOL_FIXTURES.hook.encodedHex);
  const wrongVersion = hookBytes.slice();
  wrongVersion[4] = 2;
  assert.throws(() => decodeWottaHookV1(wrongVersion), /unsupported hook version/);
});

test("CCTP wrapper decoder rejects wrong magic, version, and declared length", () => {
  const wrapperBytes = fixtureBytes(PROTOCOL_FIXTURES.cctp.encodedHex);

  const wrongMagic = wrapperBytes.slice();
  wrongMagic[0] = 0x58;
  assert.throws(() => decodeCctpHookWrapperV1(wrongMagic), /invalid CCTP hook wrapper magic/);

  const wrongVersion = wrapperBytes.slice();
  wrongVersion[4] = 2;
  assert.throws(() => decodeCctpHookWrapperV1(wrongVersion), /unsupported CCTP hook wrapper version/);

  const wrongLength = wrapperBytes.slice();
  wrongLength[5] = 0x00;
  wrongLength[6] = 0x01;
  assert.throws(() => decodeCctpHookWrapperV1(wrongLength), /length mismatch/);
});

test("Circle message codec preserves mutated source and destination domains", () => {
  const hook = {
    intentId: PROTOCOL_FIXTURES.hook.intentId,
    denominationCode: 0,
    escrowPool: PROTOCOL_FIXTURES.hook.escrowPool,
    claimHash: PROTOCOL_FIXTURES.hook.claimHash,
    publicRefundRecipient: PROTOCOL_FIXTURES.hook.publicRefundRecipient,
    expiresAt: BigInt(PROTOCOL_FIXTURES.hook.expiresAt),
    manifestVersion: 1,
  };
  const sourceMutated = decodeCircleCctpMessageV2(encodeCircleCctpMessageV2ForTest({
    sourceDomain: 7,
    tokenMessenger: "0x4bdd",
    router: "0x7e5b",
    amount: 1_000_000n,
    hook,
  }));
  assert.equal(sourceMutated.sourceDomain, 7);
  assert.equal(sourceMutated.destinationDomain, 25);

  const destMutated = decodeCircleCctpMessageV2(encodeCircleCctpMessageV2ForTest({
    sourceDomain: 6,
    destinationDomain: 24,
    tokenMessenger: "0x4bdd",
    router: "0x7e5b",
    amount: 1_000_000n,
    hook,
  }));
  assert.equal(destMutated.sourceDomain, 6);
  assert.equal(destMutated.destinationDomain, 24);
});
