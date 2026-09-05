"use client";

import { apiFetch, type MeResponse } from "@/lib/api/client";
import { AUTH_NEXT_COOKIE } from "@/lib/app-origin";
import { userFacingError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { chainIdForMode, readNetworkMode } from "@/lib/network-mode";
import type { NetworkMode } from "@/lib/network-mode";

export const AUTH_SESSION_EVENT = "wotta-session";
export type { MeResponse };

const ME_CACHE_MS = 2_000;

type ApiOk<T> = { ok: true; status: number; data: T };
type ApiErr = { ok: false; status: number; data?: undefined; error: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

let cachedMe: { network: string; expiresAt: number; result: ApiResult<MeResponse> } | undefined;
const meInFlight: Partial<Record<NetworkMode, Promise<ApiResult<MeResponse>>>> = {};

export function notifySessionChanged() {
  cachedMe = undefined;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_EVENT));
  }
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Refresh Supabase JWT before long flows or account reloads. */
export async function refreshSupabaseSession() {
  const supabase = createClient();
  await supabase.auth.refreshSession();
}

async function fetchMeWithToken(
  access: string | null,
  network: NetworkMode = readNetworkMode(),
): Promise<ApiResult<MeResponse>> {
  if (!access) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  try {
    const data = await apiFetch<MeResponse>("/v1/me", { token: access, network });
    return { ok: true, status: 200, data };
  } catch (e) {
    const message = userFacingError(e, "me_failed");
    const raw = e instanceof Error ? e.message : "me_failed";
    if (
      raw.includes("401") ||
      raw === "unauthorized" ||
      message === "Sign in again"
    ) {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.auth.refreshSession();
        const refreshed = data.session?.access_token;
        if (error || !refreshed) {
          return { ok: false, status: 401, error: "unauthorized" };
        }
        const retry = await apiFetch<MeResponse>("/v1/me", {
          token: refreshed,
          network,
        });
        return { ok: true, status: 200, data: retry };
      } catch {
        return { ok: false, status: 401, error: "unauthorized" };
      }
    }
    return { ok: false, status: 500, error: raw };
  }
}

export async function fetchMe(
  token?: string | null,
  network: NetworkMode = readNetworkMode(),
): Promise<ApiResult<MeResponse>> {
  if (token !== undefined) return fetchMeWithToken(token, network);

  if (cachedMe && cachedMe.network === network && cachedMe.expiresAt > Date.now()) return cachedMe.result;
  if (meInFlight[network]) return meInFlight[network];

  meInFlight[network] = (async () => {
    const result = await fetchMeWithToken(await getAccessToken(), network);
    cachedMe = { network, result, expiresAt: Date.now() + ME_CACHE_MS };
    return result;
  })();
  try {
    return await meInFlight[network];
  } finally {
    delete meInFlight[network];
  }
}

export function clearSupabaseBrowserCookies(): void {
  if (typeof document === "undefined") return;
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (!name) continue;
    if (name.startsWith("sb-") || name === AUTH_NEXT_COOKIE) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
  }
}

/** Drop legacy localStorage sessions from the old product-session Supabase client. */
export function clearStaleSupabaseLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("sb-")) localStorage.removeItem(key);
  }
}

export async function signOutSupabase() {
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
  } catch {
    /* ignore */
  }
  clearSupabaseBrowserCookies();
  clearStaleSupabaseLocalStorage();
  notifySessionChanged();
}

const syncInFlight: Partial<Record<NetworkMode, Promise<void>>> = {};

async function runSessionSync(network: NetworkMode): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;
  await apiFetch("/v1/session/sync", { token, method: "POST", body: {}, network });
}

/** Reconcile OAuth identities and deliver pending inbox items after sign-in or link. */
export async function syncWottaSession(options?: { notify?: boolean; network?: NetworkMode }): Promise<void> {
  try {
    const network = options?.network ?? readNetworkMode();
    if (!syncInFlight[network]) {
      syncInFlight[network] = runSessionSync(network).finally(() => {
        delete syncInFlight[network];
      });
    }
    await syncInFlight[network];
    if (options?.notify) notifySessionChanged();
  } catch {
    /* sync is best-effort; pages still load me from /v1/me */
  }
}

/** Keep a linked wallet when /v1/me briefly returns null during session refresh races. */
export function mergeMeResponse(
  prev: MeResponse | null,
  next: MeResponse,
  network: NetworkMode = readNetworkMode(),
): MeResponse {
  if (next.wallet || !prev?.wallet) return next;
  const expectedChain = chainIdForMode(network);
  if (prev.wallet.chain_id && prev.wallet.chain_id !== expectedChain) return next;
  return { ...next, wallet: prev.wallet };
}
