import { withServiceStatusToast } from "@/lib/service-status-toast";

/** API client — Bearer JWT to hosted Fastify only. */
export function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:8787"
  );
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
  } = {},
): Promise<T> {
  const request = async (): Promise<T> => {
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const url = `${apiBase()}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });
    } catch {
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
