import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_FIXTURES,
  decodeCctpHookWrapperV1,
  decodeWottaHookV1,
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
