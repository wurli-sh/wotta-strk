"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, RefreshCw } from "lucide-react";
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

type Row = {
  itemId: string;
  amount: number;
  expiresAt: number;
  status: string;
  counterparty: string;
  txHash?: string | null;
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
};
type ApiNote = {
  id: string;
  intent_id: string;
  intent: ApiIntent;
};

function formatExpiresAt(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1_000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

function claimHref(noteId: string): string {
  return `/send?tab=claim&noteId=${encodeURIComponent(noteId)}`;
}

function amountUsdc(value: number | string): number {
  return Number(BigInt(value) / 1_000_000n);
}

function normalizedStatus(intent: ApiIntent): string {
  return intent.onchain_state ?? intent.state;
}

function StatusPill({ status }: { status: string }) {
  const tone =
    ["funded", "delivered", "claimable", "pending"].includes(status)
      ? "border-warning-border bg-warning-surface text-warning"
      : status === "claimed" || status === "completed"
        ? "border-success/20 bg-success/10 text-success"
        : "border-border bg-muted text-muted-foreground";
  const label =
    ["funded", "delivered", "claimable"].includes(status)
      ? "Claimable"
      : status === "claimed" || status === "completed"
        ? "Settled"
        : status.replaceAll("_", " ");
  return <span className={cn("radius-control inline-flex items-center border px-2.5 py-1 text-xs font-medium capitalize", tone)}>{label}</span>;
}

function TableShell({
  columns,
  empty,
  emptyMessage,
  loading,
  children,
  mobile,
}: {
  columns: string[];
  empty: boolean;
  emptyMessage: string;
  loading: boolean;
  children: React.ReactNode;
  mobile: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-card">
      <div className="hidden md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 bg-brand-mist/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>{columns.map((column) => <th key={column} className="px-5 py-3 font-semibold">{column}</th>)}</tr>
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

function TestnetInboxPage({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const { vault, unlocking, unlock, sessionReady } = usePrivacyVault();
  const [tab, setTab] = useState<Tab>("incoming");
  const [incoming, setIncoming] = useState<Row[]>([]);
  const [sent, setSent] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const refresh = useCallback(async (hold = true) => {
    const operation = beginNetworkOperation("testnet");
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
        await syncWottaSession();
        operation.assertActive();
        const [notesResult, intentsResult] = await Promise.all([
          apiFetch<{ notes: ApiNote[] }>("/v1/notes", { token, network: "testnet", signal: operation.signal }),
          apiFetch<{ intents: ApiIntent[] }>("/v1/intents", { token, network: "testnet", signal: operation.signal }),
        ]);
        operation.assertActive();
        const noteRows = notesResult.notes.map((note) => ({
          itemId: note.id,
          amount: amountUsdc(note.intent.denomination),
          expiresAt: Math.floor(Date.parse(note.intent.expires_at) / 1_000),
          status: normalizedStatus(note.intent),
          counterparty: "Encrypted sender",
          txHash: note.intent.onchain_tx_hash,
        }));
        setIncoming(noteRows.filter((row) => ["funded", "delivered", "claimable"].includes(row.status)));
        setHistory(noteRows.filter((row) => ["claimed", "completed", "refunded"].includes(row.status)));
        setSent(intentsResult.intents.map((intent) => ({
          itemId: intent.id,
          amount: amountUsdc(intent.denomination),
          expiresAt: Math.floor(Date.parse(intent.expires_at) / 1_000),
          status: normalizedStatus(intent),
          counterparty: intent.route_id,
          txHash: intent.source_tx_hash,
        })));
      };
      if (hold) await withMinSkeleton(work, SKELETON_MAX_MS); else await work();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        toast.error(userFacingError(error, "Couldn’t load inbox"));
      }
    } finally {
      operation.finish();
      setBusy(false);
    }
  }, []);

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
      toast.error(userFacingError(error, "Couldn't unlock inbox"));
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
        columns={["Amount", "Expires at", "Status", ""]}
        loading
        empty={false}
        emptyMessage=""
        mobile={<InboxMobileRowsSkeleton rows={2} />}
      >
        {null}
      </TableShell>
    );
    return embedded ? waiting : (
      <PageShell title="Inbox" subtitle="Payments waiting for a private Starknet claim." maxWidth="lg">
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
  const columns = counterpartyLabel
    ? ["Amount", counterpartyLabel, "Expires at", "Status"]
    : ["Amount", "Expires at", "Status", ""];
  const emptyMessage = tab === "incoming" ? "No live claims right now." : tab === "sent" ? "Nothing sent yet." : "Nothing claimed yet.";

  const table = (
    <TableShell
      columns={columns}
      loading={loading}
      empty={!loading && rows.length === 0}
      emptyMessage={emptyMessage}
      mobile={rows.map((row) => (
        <li key={row.itemId} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-2 text-lg font-semibold tabular-nums">
              <UsdcIcon className="size-5" /> {row.amount} USDC
            </span>
            <StatusPill status={row.status} />
          </div>
          {counterpartyLabel ? <p className="text-sm font-medium">{counterpartyLabel} {row.counterparty}</p> : null}
          <p className="text-xs text-muted-foreground">Expires at {formatExpiresAt(row.expiresAt)}</p>
          {tab === "incoming" ? <Button className="w-full" onClick={() => router.push(claimHref(row.itemId))}>Claim</Button> : null}
        </li>
      ))}
    >
      {rows.map((row) => (
        <tr key={row.itemId}>
          <td className="px-5 py-4"><span className="inline-flex items-center gap-2 font-semibold tabular-nums"><UsdcIcon className="size-5" />{row.amount} USDC</span></td>
          {counterpartyLabel ? <td className="px-5 py-4 font-medium capitalize">{row.counterparty}</td> : null}
          <td className="px-5 py-4 tabular-nums text-muted-foreground">{formatExpiresAt(row.expiresAt)}</td>
          <td className="px-5 py-4"><StatusPill status={row.status} /></td>
          {!counterpartyLabel ? <td className="px-5 py-4 text-right"><Button size="sm" onClick={() => router.push(claimHref(row.itemId))}>Claim</Button></td> : null}
        </tr>
      ))}
    </TableShell>
  );

  const content = (
    <>
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
    <PageShell title="Inbox" subtitle="Payments waiting for a private Starknet claim." maxWidth="lg">{content}</PageShell>
  );
}

export function InboxPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { mode } = useNetworkMode();
  if (mode === "mainnet") {
    const blocked = (
      <WrongModeNotice
        feature="Inbox"
        detail="Not available on Mainnet. Switch to Testnet beta for escrow inbox and claim rows, or use Balance for your live-pool private balance."
        mainnetHref="/balance"
        mainnetLabel="View Mainnet balance"
      />
    );
    return embedded ? blocked : (
      <PageShell title="Inbox" subtitle="Payments waiting for a private Starknet claim." maxWidth="lg">
        {blocked}
      </PageShell>
    );
  }
  return <TestnetInboxPage embedded={embedded} />;
}
