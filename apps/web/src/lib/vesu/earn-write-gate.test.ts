import { describe, expect, it, beforeEach } from "vitest";
import {
  claimEarnTxHandled,
  createEarnWriteGate,
  getEarnWriteGate,
  resetEarnWriteGateForTests,
} from "./earn-write-gate";

describe("earn write gate", () => {
  beforeEach(() => {
    resetEarnWriteGateForTests();
  });

  it("allows only one begin until end across gate instances", () => {
    const first = createEarnWriteGate();
    const second = createEarnWriteGate();
    expect(first.tryBegin()).toBe(true);
    expect(second.tryBegin()).toBe(false);
    expect(getEarnWriteGate().tryBegin()).toBe(false);
    first.end();
    expect(second.tryBegin()).toBe(true);
    second.end();
  });

  it("end is idempotent so finally blocks stay safe", () => {
    const gate = getEarnWriteGate();
    expect(gate.tryBegin()).toBe(true);
    gate.end();
    gate.end();
    expect(gate.tryBegin()).toBe(true);
  });

  it("claims each earn transaction hash only once", () => {
    expect(claimEarnTxHandled("0xAbC")).toBe(true);
    expect(claimEarnTxHandled("0xabc")).toBe(false);
    expect(claimEarnTxHandled("0xdef")).toBe(true);
  });
});
