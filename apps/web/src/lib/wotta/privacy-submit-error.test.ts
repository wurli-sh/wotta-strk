import { describe, expect, it } from "vitest";
import { formatPrivacySubmitError } from "./privacy-submit-error";

describe("formatPrivacySubmitError", () => {
  it("extracts the RPC validation tail from starknet.js dumps", () => {
    const error = new Error(`RPC: starknet_addInvokeTransaction with params {}
-32602: Invalid Params: "Key: 'BroadcastedTransaction.Proof' Error:Field validation for 'Proof' failed on the 'base64' tag"`);
    expect(formatPrivacySubmitError(error)).toContain("Invalid Params");
    expect(formatPrivacySubmitError(error).length).toBeLessThan(200);
  });

  it("maps empty proof facts", () => {
    expect(formatPrivacySubmitError(new Error("EMPTY_PROOF_FACTS from pool"))).toMatch(/empty proof/i);
  });

  it("maps submitter STRK balance errors", () => {
    const error = new Error(
      '55: Account validation failed: "Resources bounds exceed balance (19987586107305177520)."',
    );
    expect(formatPrivacySubmitError(error)).toMatch(/low on STRK/i);
  });
});
