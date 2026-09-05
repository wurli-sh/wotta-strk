import test from "node:test";
import assert from "node:assert/strict";
import { markSourceSubmitted } from "../src/intents/service.ts";
import type { Db } from "../src/db/client.ts";

function fixture(route = "base") {
  let row = { id: "intent", owner_id: "owner", chain_id: "SN_MAIN", route_id: route, state: "quoted", version: 1, source_tx_hash: null as string | null, onchain_state: null as string | null };
  let job: Record<string, unknown> | null = null;
  let failEnqueue = false;
  const db = { from(table: string) {
    let update: Record<string, unknown> | undefined;
    const query: any = {
      select: () => query, eq: () => query, is: () => query,
      update: (value: Record<string, unknown>) => { update = value; return query; },
      maybeSingle: async () => { if (update) row = { ...row, ...update }; return { data: { ...row }, error: null }; },
      insert: async () => ({ error: null }),
      upsert: async (value: Record<string, unknown>, options: { ignoreDuplicates: boolean }) => {
        assert.equal(table, "relayer_jobs");
        assert.equal(options.ignoreDuplicates, true);
        if (failEnqueue) return { error: new Error("enqueue unavailable") };
        job ??= value;
        return { error: null };
      },
    };
    return query;
  } } as unknown as Db;
  return { db, row: () => row, job: () => job, fail: (value: boolean) => { failEnqueue = value; }, project: () => { row = { ...row, state: "claimed", version: 5, onchain_state: "claimed" }; } };
}

for (const route of ["base", "solana"]) {
  test(`${route}: retry repairs enqueue failure after the source hash was saved`, async () => {
    const f = fixture(route);
    f.fail(true);
    await assert.rejects(markSourceSubmitted(f.db, "owner", "intent", 1, "hash", "SN_MAIN"), /enqueue unavailable/);
    assert.equal(f.row().source_tx_hash, "hash");
    f.fail(false);
    await markSourceSubmitted(f.db, "owner", "intent", 1, "hash", "SN_MAIN");
    assert.equal(f.job()?.status, "queued");
    assert.equal(f.row().version, 2);
    f.job()!.status = "succeeded";
    await markSourceSubmitted(f.db, "owner", "intent", 1, "hash", "SN_MAIN");
    assert.equal(f.job()?.status, "succeeded");
    await assert.rejects(markSourceSubmitted(f.db, "owner", "intent", 1, "different", "SN_MAIN"), /version_conflict/);
  });
}

test("Starknet: source registration preserves a claim already projected by the indexer", async () => {
  const f = fixture("starknet-private");
  f.project();
  const result = await markSourceSubmitted(f.db, "owner", "intent", 1, "0xabc", "SN_MAIN");
  assert.equal(result.state, "claimed");
  assert.equal(result.version, 5);
  assert.equal(result.source_tx_hash, "0xabc");
  assert.equal(f.job(), null);
});
