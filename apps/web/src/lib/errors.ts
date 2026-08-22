/**
 * Concise, user-facing error text for toasts.
 * Collapses viem/MetaMask dumps (contract args, docs links) into one short line.
 */

import { toast } from "sonner";

const MAX_LEN = 140;

const APP_MESSAGES: Record<string, string> = {
  sign_in_required: "Sign in to continue",
  register_required: "Connect Ready from Account first",
  recipient_required: "Enter a handle or email first",
  send_failed: "Couldn’t send",
  claim_failed: "Couldn’t claim",
  withdraw_failed: "Couldn’t withdraw",
  balance_failed: "Couldn’t load balance",
  view_inbox_failed: "Couldn’t load inbox",
  wallet_failed: "Wallet action failed",
  register_failed: "Couldn’t complete registration",
  session_failed: "Couldn’t prepare session key",
  oauth_failed: "Sign-in failed",
  link_failed: "Couldn’t link account",
  unlink_failed: "Couldn’t unlink",
  me_failed: "Couldn’t load account",
  network_error: "Network error — try again",
  fce_unreachable: "Private proving service unreachable — try again",
  fcc_proxy_unavailable:
    "Private inbox is still syncing — tap Refresh in a minute",
  fcc_execution_failed:
    "Private ledger action failed — please try again shortly",
  fcc_private_session_unauthorized:
    "Private session needs to reconnect — try again",
  nonce: "Private session is syncing — try again",
  session_nonce_invalid:
    "Private session sync failed — reconnect it from Account",
  api_unreachable: "API unreachable — try again",
  unauthorized: "Sign in again",
  auth_unavailable: "Auth temporarily unavailable",
  auth_failed: "Sign-in did not complete — try again",
  claim_payout_authorization_missing:
    "Claim authorization incomplete — try again",
  insufficient_strk_claim_gas: "Add Sepolia STRK to cover the claim gas fee",
  insufficient_strk_send_gas: "Add Sepolia STRK to cover network fees",
  handle_missing: "Link X for a Wotta handle first",
  route_disabled: "That testnet route is not admitted yet",
  wallet_inbox_key_mismatch:
    "This browser’s inbox key doesn’t match the linked wallet — use the device that originally linked Ready",
  wallet_already_linked:
    "This Ready wallet is linked to another Wotta account",
  private_route_disabled: "The private Starknet route is not verified",
};

function firstLine(s: string): string {
  return s.split(/\r?\n/)[0]?.trim() ?? s.trim();
}

function truncate(s: string, max = MAX_LEN): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function asRecord(e: unknown): Record<string, unknown> | null {
  if (e && typeof e === "object") return e as Record<string, unknown>;
  return null;
}

/** Collect short strings from Error / viem BaseError / nested causes. */
function collectRawMessages(e: unknown, depth = 0): string[] {
  if (depth > 6 || e == null) return [];
  if (typeof e === "string") return [e];
  const o = asRecord(e);
  if (!o) return [];

  const out: string[] = [];
  for (const key of ["shortMessage", "details", "reason", "message"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) out.push(v);
  }
  if (typeof o.code === "number" || typeof o.code === "string") {
    out.push(`code:${o.code}`);
  }
  if (o.cause != null) out.push(...collectRawMessages(o.cause, depth + 1));
  if (e instanceof Error && e.cause != null) {
    out.push(...collectRawMessages(e.cause, depth + 1));
  }
  return out;
}

function mapKnownPhrase(raw: string): string | null {
  const m = raw.toLowerCase();

  if (
    m.includes("denied transaction signature") ||
    m.includes("transaction signature")
  ) {
    return "Transaction cancelled";
  }

  if (
    m.includes("user rejected") ||
    m.includes("user denied") ||
    m.includes("rejected the request") ||
    m.includes("request rejected") ||
    m.includes("user cancelled") ||
    m.includes("user canceled") ||
    m.includes("action_rejected") ||
    m.includes("4001") ||
    m === "code:4001" ||
    m.includes("code:4001")
  ) {
    return "Request cancelled";
  }

  if (m.includes("connection rejected") || m.includes("rejected connection")) {
    return "Connection cancelled";
  }

  if (
    m.includes("insufficient funds") ||
    m.includes("exceeds the balance") ||
    m.includes("insufficient balance")
  ) {
    return "Insufficient funds for gas or amount";
  }

  if (m.includes("gas required exceeds allowance")) {
    return "Transaction simulation failed — try again";
  }

  if (
    m.includes("insufficient_testusdt0") ||
    m.includes("insufficient usdt") ||
    m.includes("insufficient_usdt")
  ) {
    return "Insufficient USDC balance";
  }

  if (
    m.includes("chain mismatch") ||
    m.includes("wrong network") ||
    m.includes("switch chain") ||
    m.includes("unrecognized chain") ||
    m.includes("not configured for chain")
  ) {
    return "Switch Ready to Starknet Sepolia";
  }

  if (m.includes("fce_unreachable")) {
    return "Private ledger unreachable — try again";
  }

  if (m === "fce_401" || m === "api_401") {
    return "Sign in again";
  }

  if (m.startsWith("fce_") && /^fce_\d+$/.test(m.trim())) {
    return "Private ledger request failed — try again";
  }

  if (m.includes("api_unreachable")) {
    return "API unreachable — try again";
  }

  if (m.startsWith("api_") && /^api_\d+$/.test(m.trim())) {
    return "Request failed — try again";
  }

  if (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("load failed") ||
    m.includes("fetch failed")
  ) {
    return "Network error — try again";
  }

  if (m.includes("timeout") || m.includes("timed out")) {
    return "Request timed out — try again";
  }

  if (
    m.includes("nonce too low") ||
    m.includes("replacement transaction underpriced")
  ) {
    return "Wallet nonce issue — try again";
  }

  if (m.includes("execution reverted") || m.includes("reverted")) {
    // Prefer a short revert reason after "reverted:" if present
    const match = raw.match(
      /reverted(?: with reason string)?[:\s]+['"]?([^'"\n]+)/i,
    );
    if (match?.[1] && match[1].length < 80) {
      return truncate(`Transaction reverted: ${match[1].trim()}`);
    }
    return "Transaction reverted";
  }

  if (m.includes("install or unlock")) {
    return firstLine(raw);
  }

  const appKey = firstLine(raw).trim();
  if (APP_MESSAGES[appKey]) return APP_MESSAGES[appKey];

  return null;
}

/**
 * Turn any thrown value into a short toast string.
 * Prefer known wallet/chain phrases; fall back to a clipped shortMessage.
 */
export function userFacingError(
  e: unknown,
  fallback = "Something went wrong",
): string {
  if (e == null) return fallback;

  if (typeof e === "string") {
    const known = mapKnownPhrase(e);
    if (known) return known;
    if (APP_MESSAGES[e.trim()]) return APP_MESSAGES[e.trim()];
    // Huge dumps (hex, Contract Call, Docs:)
    if (
      e.includes("Contract Call:") ||
      e.includes("Docs:") ||
      e.includes("Version: viem") ||
      e.length > 200
    ) {
      const knownIn = mapKnownPhrase(e);
      if (knownIn) return knownIn;
      return fallback;
    }
    return truncate(firstLine(e));
  }

  const messages = collectRawMessages(e);
  // Prefer the most specific mapping across shortMessage/details/cause/message.
  const scored = messages
    .map((raw) => mapKnownPhrase(raw))
    .filter((m): m is string => Boolean(m));
  if (scored.length > 0) {
    const order = [
      "Transaction cancelled",
      "Insufficient USDC balance",
      "Insufficient funds for gas or amount",
      "Switch Ready to Starknet Sepolia",
      "Transaction reverted",
      "Network error — try again",
      "Request timed out — try again",
      "Wallet nonce issue — try again",
      "Connection cancelled",
      "Request cancelled",
    ];
    for (const pref of order) {
      if (scored.includes(pref)) return pref;
    }
    return scored[0]!;
  }

  // Prefer viem shortMessage when present and human-scale
  const o = asRecord(e);
  const short =
    typeof o?.shortMessage === "string" ? o.shortMessage.trim() : "";
  if (short && short.length <= MAX_LEN && !short.includes("Contract Call")) {
    return truncate(firstLine(short));
  }

  const details = typeof o?.details === "string" ? o.details.trim() : "";
  if (
    details &&
    details.length <= MAX_LEN &&
    !details.includes("0x") &&
    !details.includes("Contract Call")
  ) {
    return truncate(firstLine(details));
  }

  if (e instanceof Error && e.message) {
    const line = firstLine(e.message);
    if (
      line.includes("Contract Call:") ||
      line.includes("Docs:") ||
      e.message.includes("Version: viem") ||
      e.message.length > 200
    ) {
      return fallback;
    }
    return truncate(line);
  }

  return fallback;
}

/** Fire a short error toast — never dump raw viem/API blobs. */
export function toastErr(e: unknown, fallback = "Something went wrong") {
  toast.error(userFacingError(e, fallback));
}

/** Short success toast. */
export function toastOk(message: string) {
  toast.success(message);
}

/** Short info toast (dedupe with `id` when stable). */
export function toastInfo(message: string, id?: string) {
  toast.message(message, id ? { id } : undefined);
}
