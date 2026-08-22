import assert from "node:assert/strict";
import test from "node:test";
import { generateViewingKey } from "./privacy-state.ts";

test("generateViewingKey creates nonzero 200-bit secrets", () => {
  for (let index = 0; index < 32; index += 1) {
    const key = generateViewingKey();
    assert.ok(key > 0n);
    assert.ok(key < (1n << 200n));
  }
});
