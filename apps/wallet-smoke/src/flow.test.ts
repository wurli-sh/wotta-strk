import assert from "node:assert/strict";
import test from "node:test";
import { decodeUint256 } from "./flow.ts";

test("decodeUint256 combines Starknet low and high limbs", () => {
  assert.equal(decodeUint256(["0x2", "0x1"]), (1n << 128n) + 2n);
});

test("decodeUint256 rejects malformed balance responses", () => {
  assert.throws(() => decodeUint256(["0x1"]), /invalid u256/);
});
