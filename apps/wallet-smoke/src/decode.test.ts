import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeOpenNoteDeposits,
  decodeOpenNoteDepositsFromReceipt,
  expectedNoteDepositsForFlow,
  isEmptySimulatedProof,
  normalizeActions,
  normalizePreparedCall,
} from "./decode.ts";
import type { SmokeFlowId } from "./types.ts";

test("normalizeActions preserves ordered STRK20 action shapes", () => {
  const actions = normalizeActions([
    {
      type: "transfer",
      token: "0x1",
      amount: "OPEN",
      recipient: "0x2",
    },
    {
      type: "invoke",
      contract: "0x3",
      calldata: ["0x0", "${openNoteIds[0]}", "${poolAddress}"],
    },
  ]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.type, "transfer");
  assert.equal(actions[1]?.type, "invoke");
  assert.deepEqual(actions[1]?.calldata, [
    "0x0",
    "${openNoteIds[0]}",
    "${poolAddress}",
  ]);
});

test("isEmptySimulatedProof detects prepareInvoke simulate=true previews", () => {
  assert.equal(
    isEmptySimulatedProof({
      data: "",
      output: [],
      proof_facts: [],
    }),
    true,
  );
  assert.equal(
    isEmptySimulatedProof({
      data: "0xproof",
      output: ["0x1"],
      proof_facts: ["0x2"],
    }),
    false,
  );
});

test("normalizePreparedCall records call and empty-proof metadata", () => {
  const prepared = normalizePreparedCall({
    call: {
      contract_address: "0xpool",
      entry_point: "privacy_invoke",
      calldata: ["0x1", "0x2"],
    },
    proof: { data: "", output: [], proof_facts: [] },
  });
  assert.equal(prepared.contractAddress, "0xpool");
  assert.equal(prepared.entryPoint, "privacy_invoke");
  assert.equal(prepared.calldataLength, 2);
  assert.equal(prepared.emptyProof, true);
});

test("expectedNoteDepositsForFlow encodes escrow span semantics", () => {
  const cases: Array<[SmokeFlowId, number]> = [
    ["balances", 0],
    ["direct_transfer", 0],
    ["private_fund", 0],
    ["claim_release", 1],
  ];
  for (const [flow, count] of cases) {
    assert.equal(
      expectedNoteDepositsForFlow(flow, {
        token: "0xtoken",
        amount: "1000000",
      }).length,
      count,
    );
  }
  const claim = expectedNoteDepositsForFlow("claim_release", {
    token: "0xtoken",
    amount: "1000000",
  });
  assert.deepEqual(claim, [
    {
      noteId: "${openNoteIds[0]}",
      token: "0xtoken",
      amount: "1000000",
    },
  ]);
});

test("decodeOpenNoteDeposits accepts Cairo-style span payloads", () => {
  assert.deepEqual(decodeOpenNoteDeposits([]), []);
  assert.deepEqual(
    decodeOpenNoteDeposits([
      { note_id: "0xa", token: "0xb", amount: "5" },
    ]),
    [{ noteId: "0xa", token: "0xb", amount: "5" }],
  );
  assert.deepEqual(
    decodeOpenNoteDeposits(["0x1", "0xa", "0xb", "5"]),
    [{ noteId: "0xa", token: "0xb", amount: "5" }],
  );
});

test("decodeOpenNoteDepositsFromReceipt scans event data best-effort", () => {
  assert.deepEqual(
    decodeOpenNoteDepositsFromReceipt({
      events: [
        { data: ["0x0"] },
        { data: ["0x1", "0xa", "0xb", "5"] },
      ],
    }),
    [{ noteId: "0xa", token: "0xb", amount: "5" }],
  );
});
