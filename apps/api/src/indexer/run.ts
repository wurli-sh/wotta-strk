import { createHash } from "node:crypto";
import { hash, RpcProvider } from "starknet";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import type { Logger } from "pino";
import { acquireLease } from "../workers/lease.ts";

type Projection = {
  kind: "funded" | "claimed" | "refunded";
  claimHash: string;
  denomination: string;
  payload: Record<string, string>;
};

const SELECTORS = {
  PublicDeposited: hash.getSelectorFromName("PublicDeposited").toLowerCase(),
  RouterFunded: hash.getSelectorFromName("RouterFunded").toLowerCase(),
  PrivateFunded: hash.getSelectorFromName("PrivateFunded").toLowerCase(),
  Claimed: hash.getSelectorFromName("Claimed").toLowerCase(),
  Refunded: hash.getSelectorFromName("Refunded").toLowerCase(),
};

function felt(value: string | undefined): string {
  if (!value) throw new Error("indexer_event_truncated");
  return `0x${BigInt(value).toString(16)}`.toLowerCase();
}

/** Decode only public Wotta escrow fields; secrets and recipient identity never appear. */
export function decodeEscrowProjection(event: { keys: string[]; data: string[] }): Projection | undefined {
  const selector = event.keys[0]?.toLowerCase();
  if (!selector) return undefined;
  if (selector === SELECTORS.PublicDeposited || selector === SELECTORS.RouterFunded || selector === SELECTORS.PrivateFunded) {
    const payload: Record<string, string> = { expiresAt: BigInt(event.data[2] ?? "0").toString() };
    if (selector === SELECTORS.PublicDeposited) payload.fundingKind = BigInt(event.data[3] ?? "0").toString();
    if (selector === SELECTORS.PrivateFunded) payload.refundHash = felt(event.data[3]);
    return { kind: "funded", claimHash: felt(event.data[0]), denomination: BigInt(event.data[1] ?? "0").toString(), payload };
  }
  if (selector === SELECTORS.Claimed) {
    return { kind: "claimed", claimHash: felt(event.data[0]), denomination: BigInt(event.data[1] ?? "0").toString(), payload: {} };
  }
  if (selector === SELECTORS.Refunded) {
    return { kind: "refunded", claimHash: felt(event.data[0]), denomination: BigInt(event.data[1] ?? "0").toString(), payload: { fundingKind: BigInt(event.data[2] ?? "0").toString() } };
  }
  return undefined;
}

function deploymentStart(config: Config): number {
  const blocks = config.manifest.pools.map((pool) => pool.deployedBlock).filter((value): value is number => typeof value === "number");
  const directBlock = config.manifest.directPrivacy?.escrow?.deployedBlock;
  if (typeof directBlock === "number") blocks.push(directBlock);
  if (!blocks.length) throw new Error("indexer_deployment_block_missing");
  return Math.min(...blocks);
}

function escrowAddresses(config: Config): Set<string> {
  const addresses = config.manifest.pools.map((pool) => felt(pool.address));
  const direct = config.manifest.directPrivacy?.escrow?.address;
  if (direct) addresses.push(felt(direct));
  return new Set(addresses);
}

async function resetCanonicalReadModel(db: Db, chainId: string) {
  const { error: eventError } = await db.from("chain_events").update({ canonical: false }).eq("chain_id", chainId).eq("canonical", true);
  if (eventError) throw eventError;
  const { error: intentError } = await db.from("intents").update({ onchain_state: null, onchain_tx_hash: null, onchain_block_number: null }).not("onchain_state", "is", null);
  if (intentError) throw intentError;
}

export async function rebuildReadModel(db: Db, chainId = "SN_SEPOLIA") {
  await resetCanonicalReadModel(db, chainId);
  const { error } = await db.from("indexer_cursors").delete().eq("chain_id", chainId);
  if (error) throw error;
  return { reset: true };
}

async function receiptEventIndex(provider: RpcProvider, event: { transaction_hash: string; from_address: string; keys: string[]; data: string[] }): Promise<number> {
  const receipt = await provider.getTransactionReceipt(event.transaction_hash);
  if (!("events" in receipt)) throw new Error("indexer_receipt_events_missing");
  const index = receipt.events.findIndex((candidate) =>
    felt(candidate.from_address) === felt(event.from_address)
      && JSON.stringify(candidate.keys.map(felt)) === JSON.stringify(event.keys.map(felt))
      && JSON.stringify(candidate.data.map(felt)) === JSON.stringify(event.data.map(felt)));
  if (index < 0) throw new Error("indexer_event_not_in_receipt");
  return index;
}

async function persistProjection(db: Db, chainId: string, event: {
  block_number: number;
  block_hash: string;
  transaction_hash: string;
  from_address: string;
  keys: string[];
  data: string[];
}, eventIndex: number, projection: Projection) {
  const fingerprint = createHash("sha256").update(JSON.stringify([event.from_address, event.keys, event.data])).digest("hex");
  const { error: eventError } = await db.from("chain_events").upsert({
    chain_id: chainId,
    block_number: event.block_number,
    block_hash: event.block_hash,
    tx_hash: event.transaction_hash,
    event_index: eventIndex,
    kind: projection.kind,
    intent_id: null,
    payload: { claimHash: projection.claimHash, denomination: projection.denomination, contract: felt(event.from_address), fingerprint, ...projection.payload },
    canonical: true,
  }, { onConflict: "chain_id,tx_hash,event_index" });
  if (eventError) throw eventError;

  const { error: intentError } = await db.from("intents").update({
    onchain_state: projection.kind,
    onchain_tx_hash: event.transaction_hash,
    onchain_block_number: event.block_number,
    updated_at: new Date().toISOString(),
  }).eq("claim_hash", projection.claimHash);
  if (intentError) throw intentError;
}

/** Index verified Wotta escrow events and maintain a reorg-replayable status projection. */
export async function runIndexerOnce(deps: { db: Db; config: Config; log: Logger }) {
  const lease = await acquireLease(deps.db, "indexer");
  if (!lease) return { indexed: 0, leased: false };
  const chainId = deps.config.manifest.chainId;
  const provider = new RpcProvider({ nodeUrl: deps.config.env.STARKNET_RPC_URL });
  const start = deploymentStart(deps.config);
  const { data: cursor, error: cursorError } = await deps.db.from("indexer_cursors").select("block_number,block_hash").eq("chain_id", chainId).maybeSingle();
  if (cursorError) throw cursorError;

  let fromBlock = cursor ? Number(cursor.block_number) + 1 : start;
  if (cursor) {
    const canonical = await provider.getBlockWithTxHashes(Number(cursor.block_number));
    if (!canonical.block_hash || canonical.block_hash.toLowerCase() !== String(cursor.block_hash).toLowerCase()) {
      deps.log.warn({ chainId, blockNumber: cursor.block_number }, "Starknet reorg detected; replaying Wotta escrow projection");
      await resetCanonicalReadModel(deps.db, chainId);
      fromBlock = start;
    }
  }

  const latest = await provider.getBlockNumber();
  if (fromBlock > latest) return { indexed: 0, fromBlock, toBlock: latest };
  const addresses = escrowAddresses(deps.config);
  let continuationToken: string | undefined;
  let indexed = 0;
  do {
    const page = await provider.getEvents({
      from_block: { block_number: fromBlock },
      to_block: { block_number: latest },
      keys: [[...Object.values(SELECTORS)]],
      chunk_size: 250,
      ...(continuationToken ? { continuation_token: continuationToken } : {}),
    });
    for (const event of page.events) {
      if (!addresses.has(felt(event.from_address)) || event.block_number === undefined || !event.block_hash) continue;
      const projection = decodeEscrowProjection(event);
      if (!projection) continue;
      const eventIndex = await receiptEventIndex(provider, event as typeof event & { transaction_hash: string });
      await persistProjection(deps.db, chainId, event as typeof event & { block_number: number; block_hash: string; transaction_hash: string }, eventIndex, projection);
      indexed += 1;
    }
    continuationToken = page.continuation_token;
  } while (continuationToken);

  const latestBlock = await provider.getBlockWithTxHashes(latest);
  const { error: saveCursorError } = await deps.db.from("indexer_cursors").upsert({ chain_id: chainId, block_number: latest, block_hash: latestBlock.block_hash, updated_at: new Date().toISOString() }, { onConflict: "chain_id" });
  if (saveCursorError) throw saveCursorError;
  deps.log.info({ chainId, fromBlock, toBlock: latest, indexed }, "Wotta escrow indexer caught up");
  return { indexed, fromBlock, toBlock: latest };
}

export async function runIndexerLoop(deps: { db: Db; config: Config; log: Logger }, signal: AbortSignal) {
  while (!signal.aborted) {
    try { await runIndexerOnce(deps); }
    catch (error) { deps.log.error({ error: error instanceof Error ? error.message : "indexer_failed" }, "Wotta indexer iteration failed"); }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
