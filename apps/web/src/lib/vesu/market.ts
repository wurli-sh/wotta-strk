import { loadVesuEarn, sameFelt } from "./config";

const API_URL = "https://api.vesu.xyz/markets";
const CACHE_MS = 60_000;
const STALE_MS = 300_000;
let cache: VesuMarketStats | null = null;

type Scaled = { value: string; decimals: number };
export type VesuMarketStats = { supplyApy: number; utilization: number; updatedAt: Date; stale: boolean };

function scaledPercent(input: Scaled): number {
  const decimals = 10 ** input.decimals;
  const value = Number(input.value);
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    const integer = BigInt(input.value);
    return Number((integer * 1_000_000n) / (10n ** BigInt(input.decimals))) / 10_000;
  }
  return (value / decimals) * 100;
}

export function parseVesuMarket(payload: unknown, now = new Date()): VesuMarketStats {
  const config = loadVesuEarn();
  const data = (payload as { data?: Array<Record<string, any>> })?.data;
  const market = data?.find((item) => sameFelt(item.pool?.id, config.poolAddress) && sameFelt(item.address, config.underlyingAddress));
  if (!market || market.pool?.isDeprecated || !sameFelt(market.vToken?.address, config.vTokenAddress)) throw new Error("vesu_market_unavailable");
  const observedAt = market.config?.lastUpdated ? new Date(market.config.lastUpdated) : now;
  return {
    supplyApy: scaledPercent(market.stats.supplyApy),
    utilization: scaledPercent(market.stats.currentUtilization),
    updatedAt: observedAt,
    stale: now.getTime() - observedAt.getTime() > STALE_MS,
  };
}

export async function fetchVesuMarket(options?: { signal?: AbortSignal; now?: Date }): Promise<VesuMarketStats> {
  const now = options?.now ?? new Date();
  if (cache && now.getTime() - cache.updatedAt.getTime() < CACHE_MS) return cache;
  const timeout = AbortSignal.timeout(8_000);
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(API_URL, { signal });
  if (!response.ok) throw new Error("vesu_market_unavailable");
  cache = parseVesuMarket(await response.json(), now);
  return cache;
}
