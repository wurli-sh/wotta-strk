import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";

export type RelayerQueueHealth = {
  relayerQueued: number;
  oldestQueuedAgeSec: number | null;
  relayerFailed: number;
  strkAlert: boolean | null;
};

export async function loadRelayerQueueHealth(
  db: Db,
  options: { strkAlert: boolean | null } = { strkAlert: null },
): Promise<RelayerQueueHealth> {
  const now = Date.now();
  const [{ count: queuedCount, error: queuedError }, { count: failedCount, error: failedError }, { data: oldest, error: oldestError }] =
    await Promise.all([
      db.from("relayer_jobs").select("*", { count: "exact", head: true }).eq("status", "queued"),
      db.from("relayer_jobs").select("*", { count: "exact", head: true }).eq("status", "failed"),
      db.from("relayer_jobs").select("created_at").eq("status", "queued").order("created_at", { ascending: true }).limit(1),
    ]);
  if (queuedError) throw queuedError;
  if (failedError) throw failedError;
  if (oldestError) throw oldestError;
  const createdAt = oldest?.[0]?.created_at ? Date.parse(String(oldest[0].created_at)) : NaN;
  return {
    relayerQueued: queuedCount ?? 0,
    oldestQueuedAgeSec: Number.isFinite(createdAt) ? Math.max(0, Math.floor((now - createdAt) / 1000)) : null,
    relayerFailed: failedCount ?? 0,
    strkAlert: options.strkAlert,
  };
}

export function healthBody(
  config: Config,
  routesEnabled: number,
  queue: RelayerQueueHealth,
) {
  return {
    ok: true,
    chainId: config.manifest.chainId,
    manifestHash: config.manifestHash,
    routesEnabled,
    workers: { indexer: config.env.RUN_INDEXER, relayer: config.env.RUN_RELAYER },
    relayerQueued: queue.relayerQueued,
    oldestQueuedAgeSec: queue.oldestQueuedAgeSec,
    relayerFailed: queue.relayerFailed,
    strkAlert: queue.strkAlert,
  };
}
