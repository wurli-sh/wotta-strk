import assert from "node:assert/strict";
import test from "node:test";
import { selectProofBlock } from "./privacy-proof.ts";

test("selectProofBlock keeps the proving snapshot ten blocks behind", () => {
  assert.equal(selectProofBlock(100), 90);
});

test("selectProofBlock waits until prerequisite state is in the snapshot", () => {
  assert.equal(selectProofBlock(99, 90), undefined);
  assert.equal(selectProofBlock(100, 90), 90);
  assert.equal(selectProofBlock(101, 90), 91);
});
