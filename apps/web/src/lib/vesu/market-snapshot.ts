import type { VesuMarketStats } from "./market";

type Snapshot = { apy: number; updatedAt: string };
type SnapshotHistory = { latest: Snapshot; previous?: Snapshot };

const PREFIX = "wotta:vesu:apy-history:v1";

function validSnapshot(value: unknown): value is Snapshot {
  const snapshot = value as Partial<Snapshot> | null;
  return Boolean(
    snapshot &&
    Number.isFinite(snapshot.apy) &&
    typeof snapshot.updatedAt === "string",
  );
}

/** Stores two genuine API observations for one exact Vesu pool/asset pair. */
export function rememberApySnapshot(
  poolAddress: string,
  underlyingAddress: string,
  market: VesuMarketStats,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): number | null {
  const key = `${PREFIX}:${poolAddress.toLowerCase()}:${underlyingAddress.toLowerCase()}`;
  const next: Snapshot = {
    apy: market.supplyApy,
    updatedAt: market.updatedAt.toISOString(),
  };

  try {
    const parsed = JSON.parse(
      storage.getItem(key) ?? "null",
    ) as Partial<SnapshotHistory> | null;
    const latest = validSnapshot(parsed?.latest) ? parsed.latest : null;
    const previous = validSnapshot(parsed?.previous) ? parsed.previous : null;

    if (!latest) {
      storage.setItem(
        key,
        JSON.stringify({ latest: next } satisfies SnapshotHistory),
      );
      return null;
    }

    if (latest.updatedAt === next.updatedAt) return previous?.apy ?? null;

    storage.setItem(
      key,
      JSON.stringify({
        latest: next,
        previous: latest,
      } satisfies SnapshotHistory),
    );
    return latest.apy;
  } catch {
    return null;
  }
}
