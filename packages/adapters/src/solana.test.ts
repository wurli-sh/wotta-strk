import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { hexToBytes } from "viem";
import { buildSolanaCctpBurnTransaction, confirmSolanaCctpBurn } from "./solana.ts";

const messenger = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
const transmitter = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const mint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const text = (value: string) => new TextEncoder().encode(value);
const pda = (program: PublicKey, seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, program)[0];

test("Solana CCTP burn uses the official account layout and fits without a lookup table", () => {
  const owner = Keypair.generate().publicKey;
  const event = Keypair.generate();
  const accounts = {
    senderUsdc: Keypair.generate().publicKey,
    senderAuthority: pda(messenger, [text("sender_authority")]),
    denylist: pda(messenger, [text("denylist_account"), owner.toBytes()]),
    messageTransmitter: pda(transmitter, [text("message_transmitter")]),
    tokenMessenger: pda(messenger, [text("token_messenger")]),
    remoteTokenMessenger: pda(messenger, [text("remote_token_messenger"), text("25")]),
    tokenMinter: pda(messenger, [text("token_minter")]),
    localToken: pda(messenger, [text("local_token"), mint.toBytes()]),
    eventAuthority: pda(messenger, [text("__event_authority")]),
  };
  const hookData = `0x${"11".repeat(136)}` as const;
  const transaction = buildSolanaCctpBurnTransaction({
    owner,
    messenger,
    transmitter,
    mint,
    accounts,
    event,
    blockhash: Keypair.generate().publicKey.toBase58(),
    amount: 1_000_000n,
    destinationDomain: 25,
    mintRecipient: `0x${"22".repeat(32)}`,
    destinationCaller: `0x${"22".repeat(32)}`,
    maxFee: 0n,
    finality: 2000,
    hookData,
  });

  assert.equal(transaction.instructions.length, 1);
  assert.equal(transaction.instructions[0]?.keys.length, 18);
  assert.deepEqual(
    [...(transaction.instructions[0]?.data.subarray(0, 8) ?? [])],
    [...createHash("sha256").update("global:deposit_for_burn_with_hook").digest().subarray(0, 8)],
  );
  assert.deepEqual(
    transaction.instructions[0]?.data.subarray(-hexToBytes(hookData).length),
    Buffer.from(hexToBytes(hookData)),
  );
  assert.ok(
    transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232,
  );
});

test("Solana publishes its burn signature before confirmation RPC failure", async t => {
  const { Connection } = await import("@solana/web3.js");
  const { executeSolanaCctpBurn } = await import("./solana.ts");
  const { buildNonEvmCctpBurnPlan } = await import("./index.ts");
  const plan = buildNonEvmCctpBurnPlan({ env: "mainnet", route: "solana", router: "0x123", amount: 100_000n, hook: {
    intentId: "123e4567-e89b-42d3-a456-426614174000", denominationCode: 0, escrowPool: "0x456", claimHash: "0x789", publicRefundRecipient: "0xabc", expiresAt: 1_800_000_000n, manifestVersion: 1,
  } });
  const owner = Keypair.generate();
  const previous = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { phantom: { solana: {
    isPhantom: true, publicKey: owner.publicKey,
    signAndSendTransaction: async (tx: import("@solana/web3.js").Transaction) => {
      // The fresh Circle event account must retain its partial signature.
      assert.equal(tx.verifySignatures(false), true);
      return { signature: "solana-burn-signature" };
    },
  } } } });
  t.after(() => { if (previous === undefined) Reflect.deleteProperty(globalThis, "window"); else globalThis.window = previous; });
  t.mock.method(Connection.prototype, "getGenesisHash", async () => plan.route.solanaGenesisHash);
  t.mock.method(Connection.prototype, "getAccountInfo", async () => ({}));
  t.mock.method(Connection.prototype, "getTokenAccountBalance", async () => ({ value: { amount: "1000000" } }));
  t.mock.method(Connection.prototype, "getLatestBlockhash", async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }));
  t.mock.method(Connection.prototype, "simulateTransaction", async () => ({ value: { err: null } }));
  t.mock.method(Connection.prototype, "getSignatureStatuses", async () => ({ value: [null] }));
  t.mock.method(Connection.prototype, "isBlockhashValid", async () => { assert.equal(recorded, "solana-burn-signature"); return { value: false }; });
  t.mock.method(Connection.prototype, "getTransaction", async () => null);
  let recorded = "";
  await assert.rejects(executeSolanaCctpBurn({ plan, rpcUrl: "https://solana.example", onSubmitted: async hash => { recorded = hash; } }), /block height exceeded/);
  assert.equal(recorded, "solana-burn-signature");
});

test("Solana confirms through HTTP signature polling without opening a WebSocket", async () => {
  const connection = {
    getSignatureStatuses: async () => ({
      value: [{ confirmationStatus: "finalized", confirmations: null, err: null, slot: 123 }],
    }),
    isBlockhashValid: async () => { throw new Error("blockhash lookup should not be needed"); },
    getTransaction: async () => { throw new Error("transaction lookup should not be needed"); },
  } as unknown as Connection;

  await confirmSolanaCctpBurn(connection, "landed-signature", {
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 100,
  });
});
