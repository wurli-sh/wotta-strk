import { withServiceStatusToast } from "@/lib/service-status-toast";
import { readNetworkMode, type NetworkMode } from "@/lib/network-mode";

/** API client — Bearer JWT to hosted Fastify only. */
export function apiBase(network: NetworkMode = readNetworkMode()): string {
  const testnetUrl =
    process.env.NEXT_PUBLIC_TESTNET_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:8787";
  if (network === "mainnet") {
    const mainnetUrl = process.env.NEXT_PUBLIC_MAINNET_API_URL?.trim();
    // A mainnet action must never be sent to the testnet API as a fallback.
    // Mainnet requires a separately configured, SN_MAIN-verified API deployment.
    if (!mainnetUrl) throw new Error("mainnet_api_not_configured");
    return mainnetUrl.replace(/\/$/, "");
  }
  return testnetUrl.replace(/\/$/, "");
}

function apiErrorMessage(data: unknown, status: number): string {
  const err = data as { error?: { code?: string; message?: string } | string };
  if (typeof err?.error === "string" && err.error.trim()) {
    return err.error.trim().slice(0, 140);
  }
  const code = err?.error && typeof err.error === "object" ? err.error.code : undefined;
  const msg =
    err?.error && typeof err.error === "object" ? err.error.message : undefined;
  if (code && String(code).trim()) return String(code).trim();
  if (msg && String(msg).trim().length <= 140) return String(msg).trim();
  if (status === 401) return "unauthorized";
  if (status === 403) return "unauthorized";
  if (status >= 500) return "api_unreachable";
  return `api_${status}`;
}

export async function apiFetch<T>(
  path: string,
  opts: {
    token?: string | null;
    method?: string;
    body?: unknown;
    /** The enclosing operation already owns the loading toast. */
    suppressServiceStatus?: boolean;
    network?: NetworkMode;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const network = opts.network ?? readNetworkMode();
  const request = async (): Promise<T> => {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-wotta-network": network,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const url = `${apiBase(network)}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
        signal: opts.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new Error("api_unreachable");
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(apiErrorMessage(data, res.status));
    }
    return data as T;
  };
  return opts.suppressServiceStatus
    ? request()
    : withServiceStatusToast("api", request);
}

export type MeResponse = {
  profile: { id: string; created_at?: string; updated_at?: string } | null;
  identities: Array<{
    provider: "email" | "google" | "x";
    normalized_identifier: string;
    verified_at?: string;
  }>;
  wallet: {
    address: string;
    chain_id: string;
    inbox_pubkey: string;
    key_version: number;
    private_identity_address?: string | null;
    privacy_pool_address?: string | null;
    private_identity_verified_at?: string | null;
  } | null;
};
