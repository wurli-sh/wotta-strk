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
    expect(userFacingError(new Error("mainnet_wallet_not_deployed"))).toBe(
      "Activate this Ready Mainnet account first: add STRK and make one outgoing transaction, then retry",
    );
    expect(userFacingError(new Error("mainnet_privacy_registration_required"))).toBe(
      "Open Ready → gear → your account → Enable private tokens, tap Enable, then retry Send in Wotta",
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

  it("maps source-wallet install and network errors before Ready copy", () => {
    expect(
      userFacingError(new Error("Install or unlock Phantom to pay from Solana")),
    ).toBe("Install or unlock Phantom to pay from Solana");
    expect(
      userFacingError(new Error("Install or unlock Freighter to pay from Stellar")),
    ).toBe("Install or unlock Freighter to pay from Stellar");
    expect(
      userFacingError(new Error("Install or unlock an EVM wallet")),
    ).toBe("Install or unlock an EVM wallet");
    expect(
      userFacingError(new Error("Switch Freighter to Stellar Testnet")),
    ).toBe("Switch Freighter to Stellar Testnet");
    expect(
      userFacingError(new Error("Insufficient source-chain USDC balance")),
    ).toBe("Insufficient source-chain USDC");
    expect(
      userFacingError(new Error("Unsupported EVM source chain")),
    ).toBe("Switch MetaMask to Ethereum, Base, or Arbitrum Sepolia");
    expect(userFacingError(new Error("ready_mainnet_network_mismatch"))).toBe(
      "Disconnect or switch Ready to Starknet Mainnet, then reconnect",
    );
    expect(userFacingError(new Error("ready_testnet_network_mismatch"))).toBe(
      "Disconnect or switch Ready to Starknet Sepolia, then reconnect",
    );
    expect(userFacingError(new Error("ready_connection_unresponsive"))).toBe(
      "Ready did not answer — unlock or reopen Ready, then retry",
    );
  });

  it("maps a Sepolia indexer viewing-key mismatch after a network switch", () => {
    expect(userFacingError(new Error("privacy_viewing_key_mismatch"))).toBe(
      "Local privacy state no longer matches this identity — reconnect Ready from Account",
    );
    expect(
      userFacingError(
        new Error(
          'Indexer API /v1/sync/incoming_state failed (400): {"error":{"code":"INVALID_REQUEST","message":"viewing_key does not match the registered public key"}}',
        ),
      ),
    ).toBe("Local privacy state no longer matches this identity — reconnect Ready from Account");
    expect(
      userFacingError(new Error("JSON object requested, multiple (or no) rows returned")),
    ).toBe("Wallet link is out of sync — retry reconnect, or unlink and link Ready again from Account");
  });
});
