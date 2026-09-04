import { createHash } from "node:crypto";
import type { Config } from "../config.ts";

export type IrisMessage = { message: string; attestation: string; messageHash: string };

class IrisRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super("iris_429");
  }
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return 5 * 60_000;
  if (/^\d+$/.test(value)) return Math.max(1_000, Number(value) * 1_000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(1_000, at - Date.now()) : 5 * 60_000;
}

/** Iris material is only returned to the settlement caller; callers must never log it. */
export async function fetchAttestation(
  config: Config,
  sourceDomain: number,
  transactionHash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IrisMessage | null> {
  const url = new URL(`/v2/messages/${sourceDomain}`, config.env.CIRCLE_IRIS_BASE_URL);
  url.searchParams.set("transactionHash", transactionHash);
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (response.status === 429) throw new IrisRateLimitError(retryAfterMs(response));
  if (!response.ok) throw new Error(`iris_${response.status}`);
  const json = await response.json() as { messages?: { message: string; attestation: string; status?: string }[] };
  const current = json.messages?.[0];
  if (!current?.message || !current.attestation || current.status !== "complete") return null;
  return { ...current, messageHash: createHash("sha256").update(Buffer.from(current.message.replace(/^0x/, ""), "hex")).digest("hex") };
}

/** In-process result and poll scheduling keyed by `sourceDomain:transactionHash`. */
const IRIS_CACHE = new Map<string, { value: IrisMessage; expiresAt: number }>();
const IRIS_IN_FLIGHT = new Map<string, Promise<IrisMessage | null>>();
const IRIS_POLL_STATE = new Map<string, { attempts: number; nextPollAt: number }>();
const IRIS_CACHE_TTL_MS = 24 * 60 * 60_000;
const IRIS_CACHE_MAX_ENTRIES = 1_000;
let irisRateLimitedUntil = 0;

function irisBackoffMs(attempt: number): number {
  return Math.min(120_000, 5_000 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 1_000);
}

function deferPoll(cacheKey: string, now = Date.now()): void {
  const attempts = (IRIS_POLL_STATE.get(cacheKey)?.attempts ?? 0) + 1;
  IRIS_POLL_STATE.set(cacheKey, { attempts, nextPollAt: now + irisBackoffMs(attempts - 1) });
}

function cacheCompleted(cacheKey: string, value: IrisMessage, now = Date.now()): void {
  while (IRIS_CACHE.size >= IRIS_CACHE_MAX_ENTRIES) {
    const oldest = IRIS_CACHE.keys().next().value as string | undefined;
    if (!oldest) break;
    IRIS_CACHE.delete(oldest);
  }
  IRIS_CACHE.set(cacheKey, { value, expiresAt: now + IRIS_CACHE_TTL_MS });
  IRIS_POLL_STATE.delete(cacheKey);
}

/**
 * Wraps `fetchAttestation` with:
 * - completed-result and concurrent-request deduplication
 * - per-transaction exponential polling backoff with jitter
 * - global Retry-After cooldown on HTTP 429 (five minutes when Iris omits it)
 *
 * Never log `message` or `attestation` from the returned IrisMessage.
 */
export async function fetchAttestationWithBackoff(
  config: Config,
  sourceDomain: number,
  transactionHash: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IrisMessage | null> {
  const cacheKey = `${sourceDomain}:${transactionHash}`;
  const cached = IRIS_CACHE.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) IRIS_CACHE.delete(cacheKey);
  if (now < irisRateLimitedUntil) return null;
  const pollState = IRIS_POLL_STATE.get(cacheKey);
  if (pollState && now < pollState.nextPollAt) return null;
  const existing = IRIS_IN_FLIGHT.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      const result = await fetchAttestation(config, sourceDomain, transactionHash, fetchImpl);
      if (result) {
        cacheCompleted(cacheKey, result);
        return result;
      }
      deferPoll(cacheKey);
      return null;
    } catch (error) {
      if (error instanceof IrisRateLimitError) {
        irisRateLimitedUntil = Date.now() + error.retryAfterMs;
        deferPoll(cacheKey, irisRateLimitedUntil);
        return null;
      }
      if (error instanceof TypeError || (error instanceof Error && /^iris_5\d\d$/.test(error.message))) {
        deferPoll(cacheKey);
        return null;
      }
      throw error;
    } finally {
      IRIS_IN_FLIGHT.delete(cacheKey);
    }
  })();
  IRIS_IN_FLIGHT.set(cacheKey, request);
  return request;
}

/** Test-only state reset; no Iris message or attestation is exposed. */
export function resetIrisPollingStateForTest(): void {
  IRIS_CACHE.clear();
  IRIS_IN_FLIGHT.clear();
  IRIS_POLL_STATE.clear();
  irisRateLimitedUntil = 0;
}
