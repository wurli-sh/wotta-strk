import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { hexToBytes } from "viem";
import { buildSolanaCctpBurnTransaction } from "./solana.ts";

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
