import {
  Connection,
  Keypair,
  PublicKey,
  type BlockhashWithExpiryBlockHeight,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { hexToBytes } from "viem";
import type { NonEvmCctpBurnPlan } from "./index.ts";

type Phantom = {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  connect(): Promise<{ publicKey: PublicKey }>;
  signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }>;
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
  onSubmitted?: (txHash: string) => void | Promise<void>;
  onStage?: (stage: "connecting" | "simulating" | "signing" | "confirming") => void;
}): Promise<{ txHash: string; sourceAccount: string }> {
  const provider = phantom();
  input.onStage?.("connecting");
  const owner = provider.publicKey ?? (await provider.connect()).publicKey;
  if (input.expectedSourceAccount && owner.toBase58() !== input.expectedSourceAccount) {
    throw new Error("Phantom account changed; request a new quote");
  }
  const connection = new Connection(input.rpcUrl, "confirmed");
  if (input.plan.route.family !== "solana") throw new Error("Solana plan required");
  await assertSolanaClusterForPlan(input.plan, await connection.getGenesisHash());
  const messenger = new PublicKey(input.plan.route.tokenMessenger);
  const transmitterValue = input.plan.route.messageTransmitter;
  if (!transmitterValue) throw new Error("Solana MessageTransmitter is missing");
  const transmitter = new PublicKey(transmitterValue);
  const mint = new PublicKey(input.plan.route.usdc);
  const accounts = deriveAccounts(owner, messenger, transmitter, mint, input.plan.args.destinationDomain);

  const senderUsdcAccount = await connection.getAccountInfo(accounts.senderUsdc, "confirmed");
  if (!senderUsdcAccount) throw new Error("Solana USDC token account not found");
  const senderUsdc = await connection.getTokenAccountBalance(accounts.senderUsdc, "confirmed");
  if (BigInt(senderUsdc.value.amount) < BigInt(input.plan.args.amount)) {
    throw new Error("Insufficient source-chain USDC balance");
  }

  const event = Keypair.generate();
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = buildBurnTransaction({
    owner, messenger, transmitter, mint, accounts, event,
    blockhash: latest.blockhash,
    amount: BigInt(input.plan.args.amount),
    destinationDomain: input.plan.args.destinationDomain,
    mintRecipient: input.plan.args.mintRecipient,
    destinationCaller: input.plan.args.destinationCaller,
    maxFee: BigInt(input.plan.args.maxFee),
    finality: input.plan.args.minFinalityThreshold,
    hookData: input.plan.args.hookData,
  });
  if (serializedLength(transaction) > PACKET_LIMIT) throw new Error("Solana CCTP transaction exceeds the packet limit");
  input.onStage?.("simulating");
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    const logs = simulation.value.logs?.slice(-6).join(" | ") ?? "No program logs returned";
    throw new Error(`Solana CCTP simulation failed: ${JSON.stringify(simulation.value.err)} | ${logs}`);
  }
  input.onStage?.("signing");
  if (provider.publicKey?.toBase58() !== owner.toBase58()) throw new Error("Phantom account changed; request a new quote");
  let sent: { signature: string };
  try {
    sent = await provider.signAndSendTransaction(transaction);
  } catch (cause) {
    throw new Error("Phantom could not submit the Solana transaction", { cause });
  }
  await input.onSubmitted?.(sent.signature);
  input.onStage?.("confirming");
  await confirmSolanaCctpBurn(connection, sent.signature, latest);
  return { txHash: sent.signature, sourceAccount: owner.toBase58() };
}

/** Confirm over HTTP because the same-origin Next RPC proxy does not expose WebSockets. */
export async function confirmSolanaCctpBurn(
  connection: Connection,
  signature: string,
  latest: BlockhashWithExpiryBlockHeight,
): Promise<void> {
  const startedAt = Date.now();
  let lastRpcError: unknown;
  while (Date.now() - startedAt < 120_000) {
    let status: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number] | null = null;
    try {
      status = (await connection.getSignatureStatuses(
        [signature],
        { searchTransactionHistory: true },
      )).value[0] ?? null;
    } catch (cause) {
      lastRpcError = cause;
    }
    if (status?.err) {
      throw new Error(`Solana CCTP burn reverted: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return;
    }

    let blockhashValid: boolean | undefined;
    try {
      blockhashValid = (await connection.isBlockhashValid(
        latest.blockhash,
        { commitment: "confirmed" },
      )).value;
    } catch (cause) {
      lastRpcError = cause;
    }
    if (blockhashValid === false) {
      try {
        const transaction = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (transaction?.meta?.err) {
          throw new Error(`Solana CCTP burn reverted: ${JSON.stringify(transaction.meta.err)}`);
        }
        if (transaction) return;
      } catch (recoveryCause) {
        if (recoveryCause instanceof Error && recoveryCause.message.startsWith("Solana CCTP burn reverted:")) {
          throw recoveryCause;
        }
      }
      throw new Error(`Signature ${signature} has expired: block height exceeded.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out while confirming the Solana CCTP burn", { cause: lastRpcError });
}

export async function connectSolanaSource() {
  return (await phantom().connect()).publicKey.toBase58();
}

/** Fail closed when a private/custom RPC serves a different cluster than the signed burn plan. */
export function assertSolanaClusterForPlan(
  plan: NonEvmCctpBurnPlan,
  actualGenesisHash: string,
): void {
  const expected = plan.route.solanaGenesisHash;
  if (plan.route.family !== "solana" || !expected || actualGenesisHash !== expected) {
    throw new Error("Solana RPC network does not match the CCTP route environment");
  }
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
  };
}

export function buildSolanaCctpBurnTransaction(input: {
  owner: PublicKey; messenger: PublicKey; transmitter: PublicKey; mint: PublicKey;
  accounts: ReturnType<typeof deriveAccounts>;
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
      read(input.accounts.eventAuthority), read(input.messenger),
    ],
    data: Buffer.from(data),
  });
  const transaction = new Transaction({ feePayer: input.owner, recentBlockhash: input.blockhash }).add(instruction);
  transaction.partialSign(input.event);
  return transaction;
}

const buildBurnTransaction = buildSolanaCctpBurnTransaction;

function serializedLength(transaction: Transaction) {
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function u32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return out; }
function u64(value: bigint) { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return out; }
