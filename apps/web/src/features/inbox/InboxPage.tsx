"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { usePrivacyVault } from "@/components/PrivacyVaultProvider";
import { Button } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { UsdcIcon } from "@/components/UsdcIcon";
import { InboxMobileRowsSkeleton, InboxTableRowsSkeleton } from "@/components/ui/Skeleton";
import { apiFetch } from "@/lib/api/client";
import { syncWottaSession } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { userFacingError } from "@/lib/errors";
import { withMinSkeleton, SKELETON_MAX_MS } from "@/lib/skeleton-hold";
import { createClient } from "@/lib/supabase/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { WrongModeNotice } from "@/components/WrongModeNotice";
import { beginNetworkOperation } from "@/lib/network-operations";
import { irisMessageUrl, sourceTxExplorerUrl } from "@/features/send/sourceExplorer";
import type { SourceRail } from "@/components/SourceChips";
import { chainIdForMode, starkscanTransactionUrl } from "@/lib/network-mode";
import type { NetworkMode } from "@/lib/network-mode";
import { useRoutesHealth } from "@/features/send/useRoutesHealth";
import {
  CHECKING_PRIVATE_CLAIM_ROUTE,
  PAGE_SUBTITLES,
  PRIVATE_CLAIM_ROUTE_UNVERIFIED,
  TOAST,
} from "@/lib/brand-copy";
import { formatUsdc } from "@/lib/format/amount";
import { canDecryptInboxNote } from "@/lib/wotta/inbox-note-access";
import { inboxLinkWarning } from "@/lib/wotta/inbox-binding";

const SELF_SETTLE_MS = 900_000;

function recoveryHintForSent(intent: {
  state: string;
  onchain_state?: string | null;
  updated_at?: string;
  relayer_status?: string | null;
  recoveryHint?: string | null;
  created_at?: string;
  route_id: string;
}): string | null {
  if (intent.route_id === "starknet-public" || intent.route_id === "starknet-private") return null;
  if (intent.state === "failed_recoverable") return "failed_recoverable";
  if (intent.state === "attestation_ready" || intent.state === "destination_submitted") {
    const anchor = intent.updated_at ?? intent.created_at;
    if (anchor && Date.now() - Date.parse(anchor) >= SELF_SETTLE_MS) return "self_settle";
  }
  return null;
}

type Row = {
  itemId: string;
  amount: string;
  at: number;
  expiresAt: number;
  status: string;
  counterparty: string;
  sourceTxHash?: string | null;
  destTxHash?: string | null;
  routeId?: string | null;
  recoveryHint?: string | null;
  /** Local vault cannot decrypt this still-claimable note (stale inbox key). */
  lockedOut?: boolean;
  settled?: boolean;
  claimable?: boolean;
};
type Tab = "incoming" | "sent" | "history";
type ApiIntent = {
  id: string;
  denomination: number | string;
  route_id: string;
  state: string;
  onchain_state?: string | null;
  source_tx_hash?: string | null;
  onchain_tx_hash?: string | null;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
  relayer_status?: string | null;
  recoveryHint?: string | null;
};
type ApiNote = {
  id: string;
  intent_id: string;
  created_at: string;
  delivered_at?: string | null;
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
  algorithm: "x25519-xsalsa20-poly1305";
  intent: ApiIntent;
};
type ApiIntentWithCreated = ApiIntent & { created_at?: string };

function formatRowTimeParts(unixSeconds: number): { day: string; time: string } | null {
  const date = new Date(unixSeconds * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return {
    day: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

function formatRowTime(unixSeconds: number) {
  const parts = formatRowTimeParts(unixSeconds);
  if (!parts) return "—";
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{parts.day}</span>
      <span>{parts.time}</span>
    </span>
  );
}

function formatRowTimeInline(unixSeconds: number): string {
  const parts = formatRowTimeParts(unixSeconds);
  if (!parts) return "—";
  return `${parts.day}, ${parts.time}`;
}

function claimHref(noteId: string): string {
  return `/send?tab=claim&noteId=${encodeURIComponent(noteId)}`;
}

function amountUsdc(value: number | string): string {
  return formatUsdc(value);
}

function normalizedStatus(intent: ApiIntent): string {
  return intent.onchain_state ?? intent.state;
}

/** Short inbox labels — raw snake_case must not spill into the Links column. */
function statusLabel(status: string): string {
  switch (status) {
    case "locked_out":
      return "Wrong device";
    case "funded":
    case "delivered":
    case "claimable":
      return "Claimable";
    case "claimed":
    case "completed":
      return "Settled";
    case "source_submitted":
      return "Submitted";
    case "source_confirmed":
      return "Confirming";
    case "attestation_ready":
    case "destination_submitted":
      return "Settling";
    case "failed_recoverable":
      return "Needs retry";
    case "failed_terminal":
      return "Failed";
    case "refundable":
      return "Refundable";
    case "refunded":
      return "Refunded";
    case "expired":
      return "Expired";
    case "pending":
      return "Pending";
    default:
      return status.replaceAll("_", " ");
  }
}

function StatusPill({ status }: { status: string }) {
  const inFlight = [
    "funded",
    "delivered",
    "claimable",
    "pending",
    "source_submitted",
    "source_confirmed",
    "attestation_ready",
    "destination_submitted",
  ].includes(status);
  const tone =
    status === "locked_out"
      ? "border-border bg-muted text-muted-foreground"
      : inFlight
        ? "border-warning-border bg-warning-surface text-warning"
        : status === "claimed" || status === "completed"
          ? "border-success/20 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground";
  const label = statusLabel(status);
  return (
    <span
      title={label}
      className={cn(
        "radius-control inline-flex h-7 max-w-full items-center truncate border px-2.5 text-xs font-medium leading-none",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function TableShell({
  columns,
  columnWidths,
  empty,
  emptyMessage,
  loading,
  children,
  mobile,
}: {
  columns: string[];
  /** Fixed tracks keep every tab aligned and make the table fill its card. */
  columnWidths?: string[];
  empty: boolean;
  emptyMessage: string;
  loading: boolean;
  children: React.ReactNode;
  mobile: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
      <div className="hidden overflow-hidden md:block">
        <table className="w-full table-fixed text-left text-sm">
          {columnWidths ? (
            <colgroup>
              {columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
            </colgroup>
          ) : null}
          <thead className="border-b border-border/60 bg-brand-mist/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="truncate whitespace-nowrap px-2 py-2.5 font-semibold first:pl-4 last:pr-4"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {loading ? <InboxTableRowsSkeleton columns={columns.length} rows={3} /> : empty ? (
              <tr><td colSpan={columns.length} className="px-5 py-14 text-center text-muted-foreground">{emptyMessage}</td></tr>
            ) : children}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border/50 md:hidden">
        {loading ? <InboxMobileRowsSkeleton rows={2} /> : empty ? (
          <li className="px-5 py-14 text-center text-sm text-muted-foreground">{emptyMessage}</li>
        ) : mobile}
      </ul>
    </div>
  );
}

function EscrowInboxPage({ embedded = false, mode }: { embedded?: boolean; mode: NetworkMode }) {
  const router = useRouter();
  const { vault, unlocking, unlock, sessionReady, inboxLinkStatus } = usePrivacyVault();
  const [tab, setTab] = useState<Tab>("incoming");
  const [incoming, setIncoming] = useState<Row[]>([]);
  const [sent, setSent] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const refresh = useCallback(async (hold = true) => {
    const operation = beginNetworkOperation(mode);
    setBusy(true);
    try {
      const work = async () => {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setSignedIn(false);
          setIncoming([]);
          setSent([]);
          setHistory([]);
          return;
        }
        setSignedIn(true);
        await syncWottaSession({ network: mode });
        operation.assertActive();
        const [notesResult, intentsResult] = await Promise.all([
          apiFetch<{ notes: ApiNote[]; chainId: string }>("/v1/notes", { token, network: mode, signal: operation.signal }),
          apiFetch<{ intents: ApiIntent[]; chainId: string }>("/v1/intents", { token, network: mode, signal: operation.signal }),
        ]);
        operation.assertActive();
        const expectedChainId = chainIdForMode(mode);
        if (notesResult.chainId !== expectedChainId || intentsResult.chainId !== expectedChainId) {
          throw new Error("inbox_network_scope_mismatch");
        }
        const noteReceivedAt = (note: ApiNote) => note.delivered_at ?? note.created_at;
        const inboxSecret = vault?.state.inboxSecretKey;
        const noteRows = notesResult.notes.map((note) => {
          const onchainStatus = normalizedStatus(note.intent);
          const claimable = ["funded", "delivered", "claimable"].includes(onchainStatus);
          const settled = ["claimed", "completed", "refunded"].includes(onchainStatus);
          // Only flag wrong-device for notes that are still claimable on-chain.
          // Already-claimed notes stay in History even if this browser lost the key.
          const openable = !inboxSecret || canDecryptInboxNote(note, inboxSecret);
          const lockedOut = Boolean(inboxSecret) && !openable && claimable;
          return {
            itemId: note.id,
            amount: amountUsdc(note.intent.denomination),
            at: Math.floor(Date.parse(noteReceivedAt(note)) / 1_000),
            expiresAt: Math.floor(Date.parse(note.intent.expires_at) / 1_000),
            status: lockedOut ? "locked_out" : onchainStatus,
            counterparty: "Encrypted sender",
            sourceTxHash: note.intent.source_tx_hash,
            destTxHash: note.intent.onchain_tx_hash,
            routeId: note.intent.route_id,
            lockedOut,
            settled,
            claimable,
          };
        });
        setIncoming(noteRows.filter((row) => row.claimable || row.lockedOut));
        setHistory(noteRows.filter((row) => row.settled));
        setSent(intentsResult.intents
          // A quote is only a wallet prompt preparation, not a sent payment.
          // Failed/rejected wallet attempts must not appear as duplicate sends.
          .filter((intent) => Boolean(intent.source_tx_hash) || !["draft", "quoted"].includes(intent.state))
          .map((intent: ApiIntentWithCreated) => ({
          itemId: intent.id,
          amount: amountUsdc(intent.denomination),
          at: Math.floor(Date.parse(intent.created_at ?? intent.expires_at) / 1_000),
          expiresAt: Math.floor(Date.parse(intent.expires_at) / 1_000),
          status: intent.relayer_status === "failed" ? "failed_recoverable" : normalizedStatus(intent),
          counterparty: intent.route_id,
          sourceTxHash: intent.source_tx_hash,
          destTxHash: intent.onchain_tx_hash,
          routeId: intent.route_id,
          recoveryHint: intent.recoveryHint ?? recoveryHintForSent(intent),
        })));
      };
      if (hold) await withMinSkeleton(work, SKELETON_MAX_MS); else await work();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(userFacingError(error, TOAST.inboxLoadFailed));
      }
    } finally {
      operation.finish();
      setBusy(false);
    }
  }, [mode, vault]);

  useEffect(() => {
    void (async () => {
      const { data } = await createClient().auth.getSession();
      setSignedIn(Boolean(data.session?.access_token));
    })();
  }, []);

  useEffect(() => {
    if (!signedIn || !vault) return;
    void refresh(false);
  }, [signedIn, vault, refresh]);

  async function unlockInbox() {
    try {
      await unlock();
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, TOAST.inboxUnlockFailed));
    }
  }

  if (signedIn === false) {
    const signedOut = (
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card px-5 py-14 text-center text-sm text-muted-foreground shadow-card">
        Sign in from Account, then return here.
      </div>
    );
    return embedded ? signedOut : <PageShell title="Inbox" subtitle="Sign in to see what's waiting." maxWidth="lg">{signedOut}</PageShell>;
  }

  if (signedIn === null || !sessionReady) {
    const waiting = (
      <TableShell
        columns={["Amount", "Received", "Expires at", "Status", ""]}
        loading
        empty={false}
        emptyMessage=""
        mobile={<InboxMobileRowsSkeleton rows={2} />}
      >
        {null}
      </TableShell>
    );
    return embedded ? waiting : (
      <PageShell title="Inbox" subtitle={PAGE_SUBTITLES.inbox} maxWidth="lg">
        {waiting}
      </PageShell>
    );
  }

  if (signedIn && !vault) {
    const locked = (
      <div className="flex flex-col items-center gap-4 overflow-hidden rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center shadow-card">
        <Inbox className="size-10 text-muted-foreground" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">Unlock your inbox</h2>
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            Authorize Ready once to decrypt payments and browse incoming, sent, and history.
          </p>
        </div>
        <Button
          variant="outline"
          className="min-w-[10rem]"
          disabled={unlocking}
          aria-busy={unlocking}
          onClick={() => void unlockInbox()}
        >
          {unlocking ? "Unlocking…" : "Unlock inbox"}
        </Button>
      </div>
    );
    return embedded ? locked : (
      <PageShell title="Inbox" subtitle="Unlock with Ready to view your payments." maxWidth="lg">
        {locked}
      </PageShell>
    );
  }

  const loading = signedIn === null || busy;
  const rows = tab === "incoming" ? incoming : tab === "sent" ? sent : history;
  const counterpartyLabel = tab === "sent" ? "Source" : tab === "history" ? "From" : null;
  const timeColumnLabel = tab === "sent" ? "Sent" : "Received";
  const columns = counterpartyLabel
    ? ["Amount", counterpartyLabel, timeColumnLabel, "Expires at", "Status", "Links"]
    : ["Amount", timeColumnLabel, "Expires at", "Status", "Action"];
  const columnWidths = counterpartyLabel
    ? ["16%", "11%", "15%", "15%", "23%", "20%"]
    : ["25%", "19%", "19%", "21%", "16%"];
  const emptyMessage = tab === "incoming" ? "No live claims right now." : tab === "sent" ? "Nothing sent yet." : "Nothing claimed yet.";
  const networkMode = mode;

  function rowLinks(row: Row) {
    const sourceUrl = row.sourceTxHash
      ? sourceTxExplorerUrl(row.routeId as SourceRail, row.sourceTxHash, networkMode)
      : null;
    const destUrl = row.destTxHash ? starkscanTransactionUrl(networkMode, row.destTxHash) : null;
    const irisUrl = row.sourceTxHash && row.routeId
      ? irisMessageUrl(row.routeId as SourceRail, row.sourceTxHash, networkMode)
      : null;
    const links = [
      sourceUrl ? { href: sourceUrl, label: "Burn", title: "Source burn" } : null,
      destUrl ? { href: destUrl, label: "Settle", title: "Starknet settle" } : null,
      (row.recoveryHint === "self_settle" || row.recoveryHint === "failed_recoverable") && irisUrl
        ? { href: irisUrl, label: "Self-settle", title: "Settle yourself" }
        : null,
    ].filter(Boolean) as Array<{ href: string; label: string; title: string }>;

    if (links.length === 0) {
      return <span className="text-xs text-muted-foreground">—</span>;
    }

    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {links.map((link) => (
          <a
            key={link.label}
            className="whitespace-nowrap text-xs font-semibold text-brand-ink underline decoration-brand-ink/60 underline-offset-2 hover:text-brand-dark"
            href={link.href}
            title={link.title}
            target="_blank"
            rel="noreferrer"
          >
            {link.label}
          </a>
        ))}
      </div>
    );
  }

  const table = (
    <TableShell
      columns={columns}
      columnWidths={columnWidths}
      loading={loading}
      empty={!loading && rows.length === 0}
      emptyMessage={emptyMessage}
      mobile={rows.map((row) => (
        <li key={row.itemId} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-lg font-semibold tabular-nums">
              <UsdcIcon className="size-5" /> {row.amount}
            </span>
            <StatusPill status={row.status} />
          </div>
          {counterpartyLabel ? <p className="text-sm font-medium">{counterpartyLabel} {row.counterparty}</p> : null}
          <p className="text-xs text-muted-foreground">{timeColumnLabel} {formatRowTimeInline(row.at)}</p>
          <p className="text-xs text-muted-foreground">Expires at {formatRowTimeInline(row.expiresAt)}</p>
          {tab === "incoming" ? (
            row.lockedOut ? (
              <p className="text-xs text-muted-foreground">
                Encrypted to a previous or different inbox key — use the browser that holds that key.
              </p>
            ) : (
              <Button className="w-full" onClick={() => router.push(claimHref(row.itemId))}>Claim</Button>
            )
          ) : null}
          {tab === "sent" || tab === "history" ? rowLinks(row) : null}
        </li>
      ))}
    >
      {rows.map((row) => (
        <tr key={row.itemId} className="align-middle">
          <td className="whitespace-nowrap px-2 py-3.5 first:pl-4">
            <span className="inline-flex items-center gap-2 font-semibold tabular-nums">
              <UsdcIcon className="size-5 shrink-0" />
              {row.amount}
            </span>
          </td>
          {counterpartyLabel ? (
            <td className="truncate whitespace-nowrap px-2 py-3.5 font-medium capitalize" title={row.counterparty}>{row.counterparty}</td>
          ) : null}
          <td className="whitespace-nowrap px-2 py-3.5 tabular-nums text-muted-foreground">{formatRowTime(row.at)}</td>
          <td className="whitespace-nowrap px-2 py-3.5 tabular-nums text-muted-foreground">{formatRowTime(row.expiresAt)}</td>
          <td className="max-w-0 overflow-hidden px-2 py-3.5">
            <StatusPill status={row.status} />
          </td>
          {tab === "sent" || tab === "history" ? (
            <td className="overflow-hidden px-2 py-3.5 last:pr-4">{rowLinks(row)}</td>
          ) : (
            <td className="min-w-0 px-2 py-3.5 text-right last:pr-4">
              {row.lockedOut ? (
                <span className="block truncate text-xs font-medium text-muted-foreground">Unavailable</span>
              ) : (
                <Button size="sm" onClick={() => router.push(claimHref(row.itemId))}>Claim</Button>
              )}
            </td>
          )}
        </tr>
      ))}
    </TableShell>
  );

  const content = (
    <>
      {["key_mismatch", "wrong_wallet", "network_mismatch"].includes(inboxLinkStatus) ? (
        <section className="mb-4 flex gap-3 rounded-2xl border border-warning-border bg-warning-surface p-4" role="alert">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-foreground">Inbox link needs attention</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {inboxLinkWarning(mode, inboxLinkStatus)} Existing payments stay tied to the key used when they were sent.
            </p>
          </div>
        </section>
      ) : null}
      <div className="relative mb-6 flex items-center justify-center">
        <SegmentedTabs
          layoutId="inbox-sections"
          ariaLabel="Inbox sections"
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          items={[{ value: "incoming", label: "Incoming" }, { value: "sent", label: "Sent" }, { value: "history", label: "History" }]}
        />
        <Button
          variant="secondary"
          size="sm"
          className="absolute right-0 top-1/2 min-h-8 -translate-y-1/2 px-2.5 py-1 text-xs"
          disabled={busy || signedIn === null}
          aria-busy={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden /> Refresh
        </Button>
      </div>
      {table}
    </>
  );

  return embedded ? content : (
    <PageShell title="Inbox" subtitle={PAGE_SUBTITLES.inbox} maxWidth="lg">{content}</PageShell>
  );
}

export function InboxPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { mode } = useNetworkMode();
  const { routes, routesReady } = useRoutesHealth(mode, mode === "mainnet");
  const privateRoute = routes.find((route) => route.key === "starknet-private");
  const mainnetEscrowReady = privateRoute?.selectable === true;
  if (mode === "mainnet" && !routesReady) {
    const loading = <InboxMobileRowsSkeleton rows={2} />;
    return embedded ? loading : (
      <PageShell title="Inbox" subtitle={CHECKING_PRIVATE_CLAIM_ROUTE} maxWidth="lg">{loading}</PageShell>
    );
  }
  if (mode === "mainnet" && routesReady && !mainnetEscrowReady) {
    const blocked = (
      <WrongModeNotice
        feature="Inbox"
        detail={privateRoute?.reason ?? PRIVATE_CLAIM_ROUTE_UNVERIFIED}
        mainnetHref="/account?tab=wallet"
        mainnetLabel="View Mainnet balance"
      />
    );
    return embedded ? blocked : (
      <PageShell title="Inbox" subtitle={PAGE_SUBTITLES.inbox} maxWidth="lg">
        {blocked}
      </PageShell>
    );
  }
  return <EscrowInboxPage embedded={embedded} mode={mode} />;
}
