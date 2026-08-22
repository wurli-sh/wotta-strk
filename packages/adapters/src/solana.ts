import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { hexToBytes } from "viem";
import type { NonEvmCctpBurnPlan } from "./index.ts";

type Phantom = {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(transaction: Transaction | VersionedTransaction): Promise<{ signature: string }>;
};

declare global {
  interface Window { phantom?: { solana?: Phantom } }
}

const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const DEPOSIT_WITH_HOOK = new Uint8Array([111, 245, 62, 131, 204, 108, 223, 155]);
const PACKET_LIMIT = 1232;

export async function executeSolanaCctpBurn(input: {
  plan: NonEvmCctpBurnPlan;
  rpcUrl: string;
  expectedSourceAccount?: string;
  onStage?: (stage: "connecting" | "lookup" | "simulating" | "signing" | "confirming") => void;
}): Promise<{ txHash: string; sourceAccount: string }> {
  const provider = phantom();
  input.onStage?.("connecting");
  const owner = provider.publicKey ?? (await provider.connect()).publicKey;
  if (input.expectedSourceAccount && owner.toBase58() !== input.expectedSourceAccount) {
    throw new Error("Phantom account changed; request a new quote");
  }
  const connection = new Connection(input.rpcUrl, "confirmed");
  if (input.plan.route.family !== "solana") throw new Error("Solana plan required");
  const messenger = new PublicKey(input.plan.route.tokenMessenger);
  const transmitterValue = input.plan.route.messageTransmitter;
  if (!transmitterValue) throw new Error("Solana MessageTransmitter is missing");
  const transmitter = new PublicKey(transmitterValue);
  const mint = new PublicKey(input.plan.route.usdc);
  const accounts = deriveAccounts(owner, messenger, transmitter, mint, input.plan.args.destinationDomain);

  input.onStage?.("lookup");
  const lookup = await setupLookupTable(connection, provider, owner, [
    accounts.senderUsdc, accounts.senderAuthority, accounts.denylist,
    accounts.messageTransmitter, accounts.tokenMessenger,
    accounts.remoteTokenMessenger, accounts.tokenMinter, accounts.localToken,
    mint, transmitter, messenger, TOKEN_PROGRAM, SystemProgram.programId,
    accounts.eventAuthority, accounts.transmitterEventAuthority,
  ]);
  const event = Keypair.generate();
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = buildBurnTransaction({
    owner, messenger, transmitter, mint, accounts, lookup, event,
    blockhash: latest.blockhash,
    amount: BigInt(input.plan.args.amount),
    destinationDomain: input.plan.args.destinationDomain,
    mintRecipient: input.plan.args.mintRecipient,
    destinationCaller: input.plan.args.destinationCaller,
    maxFee: BigInt(input.plan.args.maxFee),
    finality: input.plan.args.minFinalityThreshold,
    hookData: input.plan.args.hookData,
  });
  if (transaction.serialize().length > PACKET_LIMIT) throw new Error("Solana CCTP transaction exceeds the packet limit");
  input.onStage?.("simulating");
  const simulation = await connection.simulateTransaction(transaction, { commitment: "confirmed", sigVerify: false });
  if (simulation.value.err) throw new Error(`Solana CCTP simulation failed: ${JSON.stringify(simulation.value.err)} ${simulation.value.logs?.slice(-2).join(" ") ?? ""}`);
  input.onStage?.("signing");
  if (provider.publicKey?.toBase58() !== owner.toBase58()) throw new Error("Phantom account changed; request a new quote");
  const sent = await provider.signAndSendTransaction(transaction);
  input.onStage?.("confirming");
  const confirmation = await connection.confirmTransaction({ signature: sent.signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error("Solana CCTP burn reverted");
  return { txHash: sent.signature, sourceAccount: owner.toBase58() };
}

export async function connectSolanaSource() {
  return (await phantom().connect()).publicKey.toBase58();
}

function phantom(): Phantom {
  const provider = globalThis.window?.phantom?.solana;
  if (!provider?.isPhantom) throw new Error("Install or unlock Phantom to pay from Solana");
  return provider;
}

function pda(program: PublicKey, seeds: Uint8Array[]) {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

function deriveAccounts(owner: PublicKey, messenger: PublicKey, transmitter: PublicKey, mint: PublicKey, destinationDomain: number) {
  const text = (value: string) => new TextEncoder().encode(value);
  return {
    senderUsdc: pda(ASSOCIATED_TOKEN_PROGRAM, [owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()]),
    senderAuthority: pda(messenger, [text("sender_authority")]),
    denylist: pda(messenger, [text("denylist_account"), owner.toBytes()]),
    messageTransmitter: pda(transmitter, [text("message_transmitter")]),
    tokenMessenger: pda(messenger, [text("token_messenger")]),
    remoteTokenMessenger: pda(messenger, [text("remote_token_messenger"), text(String(destinationDomain))]),
    tokenMinter: pda(messenger, [text("token_minter")]),
    localToken: pda(messenger, [text("local_token"), mint.toBytes()]),
    eventAuthority: pda(messenger, [text("__event_authority")]),
    transmitterEventAuthority: pda(transmitter, [text("__event_authority")]),
  };
}

async function setupLookupTable(connection: Connection, provider: Phantom, owner: PublicKey, addresses: PublicKey[]): Promise<AddressLookupTableAccount> {
  const recentSlot = await connection.getSlot("finalized");
  const [create, lookupAddress] = AddressLookupTableProgram.createLookupTable({ authority: owner, payer: owner, recentSlot });
  const extend = AddressLookupTableProgram.extendLookupTable({ authority: owner, payer: owner, lookupTable: lookupAddress, addresses });
  const latest = await connection.getLatestBlockhash("confirmed");
  const sent = await provider.signAndSendTransaction(new Transaction({ feePayer: owner, ...latest }).add(create, extend));
  const confirmation = await connection.confirmTransaction({ signature: sent.signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error("Solana lookup table setup failed");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [lookup, slot] = await Promise.all([connection.getAddressLookupTable(lookupAddress, { commitment: "confirmed" }), connection.getSlot("confirmed")]);
    if (lookup.value && BigInt(slot) > BigInt(lookup.value.state.lastExtendedSlot)) return lookup.value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Solana lookup table did not activate");
}

function buildBurnTransaction(input: {
  owner: PublicKey; messenger: PublicKey; transmitter: PublicKey; mint: PublicKey;
  accounts: ReturnType<typeof deriveAccounts>; lookup: AddressLookupTableAccount;
  event: Keypair; blockhash: string; amount: bigint; destinationDomain: number;
  mintRecipient: `0x${string}`; destinationCaller: `0x${string}`;
  maxFee: bigint; finality: number; hookData: `0x${string}`;
}) {
  const hook = hexToBytes(input.hookData);
  const data = concat(DEPOSIT_WITH_HOOK, u64(input.amount), u32(input.destinationDomain), hexToBytes(input.mintRecipient), hexToBytes(input.destinationCaller), u64(input.maxFee), u32(input.finality), u32(hook.length), hook);
  const read = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
  const write = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });
  const instruction = new TransactionInstruction({
    programId: input.messenger,
    keys: [
      { pubkey: input.owner, isSigner: true, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: true },
      read(input.accounts.senderAuthority), write(input.accounts.senderUsdc), read(input.accounts.denylist),
      write(input.accounts.messageTransmitter), read(input.accounts.tokenMessenger), read(input.accounts.remoteTokenMessenger),
      read(input.accounts.tokenMinter), write(input.accounts.localToken), write(input.mint),
      { pubkey: input.event.publicKey, isSigner: true, isWritable: true },
      read(input.transmitter), read(input.messenger), read(TOKEN_PROGRAM), read(SystemProgram.programId),
      read(input.accounts.eventAuthority), read(input.messenger), read(input.accounts.transmitterEventAuthority), read(input.transmitter),
    ],
    data: Buffer.from(data),
  });
  const message = new TransactionMessage({ payerKey: input.owner, recentBlockhash: input.blockhash, instructions: [instruction] }).compileToV0Message([input.lookup]);
  const transaction = new VersionedTransaction(message);
  transaction.sign([input.event]);
  return transaction;
}

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function u32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out; }
function u64(value: bigint) { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return out; }
