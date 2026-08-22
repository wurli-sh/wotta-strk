import { describe, expect, it } from "vitest";
import { userFacingError } from "./errors";

describe("userFacingError", () => {
  it("maps MetaMask denied tx signature to a short cancel message", () => {
    const dump = `The contract function "deposit" reverted.

Contract Call:
  address:   0x863a1c189bf7631825a0ea4a13b1b8a350260687
  function:  deposit(bytes32 depositId, ...)
  sender:   0xFbc83d9aDA8F06242a528b62A63728e1EF7DE066

Docs: https://viem.sh/docs/contract/writeContract
Details: MetaMask Tx Signature: User denied transaction signature.
Version: viem@2.55.10`;
    expect(userFacingError(new Error(dump))).toBe("Transaction cancelled");
  });

  it("uses viem shortMessage and details", () => {
    const e = Object.assign(new Error("long dump with Contract Call: stuff"), {
      shortMessage: "User rejected the request.",
      details: "User denied transaction signature.",
    });
    expect(userFacingError(e)).toBe("Transaction cancelled");
  });

  it("maps known app codes", () => {
    expect(userFacingError(new Error("register_required"))).toBe(
      "Connect Ready from Account first",
    );
    expect(userFacingError(new Error("fcc_proxy_unavailable"))).toBe(
      "Private inbox is still syncing — tap Refresh in a minute",
    );
    expect(userFacingError(new Error("nonce"))).toBe(
      "Private session is syncing — try again",
    );
    expect(
      userFacingError(
        new Error(
          "Transaction reverted: gas required exceeds allowance (43442)",
        ),
      ),
    ).toBe("Transaction simulation failed — try again");
  });

  it("falls back for unknown giant dumps", () => {
    expect(
      userFacingError(
        new Error("x".repeat(300) + "\nContract Call:\nDocs:\nVersion: viem"),
        "Couldn’t send",
      ),
    ).toBe("Couldn’t send");
  });
});
