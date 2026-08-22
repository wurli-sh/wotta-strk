import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("skeleton-shimmer radius-surface-inner", className)}
      aria-hidden
    />
  );
}

function PanelHeaderSkeleton() {
  return (
    <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
      <Skeleton className="size-9 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3.5 w-full max-w-[16rem]" />
      </div>
    </div>
  );
}

function PageHeaderSkeleton({
  titleW = "w-28",
  subW = "w-64",
}: {
  titleW?: string;
  subW?: string;
}) {
  return (
    <div className="space-y-3 text-center">
      <Skeleton className={cn("mx-auto h-9 sm:h-10", titleW)} />
      <Skeleton className={cn("mx-auto h-4 max-w-full sm:h-5", subW)} />
    </div>
  );
}

export function HandleRowSkeleton() {
  return (
    <div className="radius-surface-inner flex items-center gap-3 border border-border/70 px-4 py-3">
      <Skeleton className="size-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-40 max-w-[70%]" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="radius-control h-8 w-16 shrink-0" />
    </div>
  );
}

export function HandlesListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-busy="true"
      aria-label="Loading handles"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <HandleRowSkeleton key={i} />
      ))}
    </div>
  );
}

/** Full Handles tab card skeleton — header + rows + actions. */
export function HandlesPanelSkeleton() {
  return (
    <section
      className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card"
      role="status"
      aria-busy="true"
      aria-label="Loading handles"
    >
      <PanelHeaderSkeleton />
      <div className="space-y-4 p-5 sm:p-6">
        <HandlesListSkeleton rows={3} />
        <div className="flex flex-col gap-2 pt-0.5">
          <Skeleton className="radius-control h-11 w-full" />
          <Skeleton className="radius-control h-11 w-full" />
        </div>
      </div>
    </section>
  );
}

/** Full Wallet tab card skeleton — header + address + action. */
export function WalletPanelSkeleton() {
  return (
    <section
      className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card"
      role="status"
      aria-busy="true"
      aria-label="Loading wallet"
    >
      <PanelHeaderSkeleton />
      <div className="space-y-3 p-5 sm:p-6">
        <div className="radius-surface-inner flex items-center gap-3 border border-brand-muted/40 bg-brand-mist/60 px-4 py-3">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="radius-control h-9 w-28" />
          <Skeleton className="radius-control h-9 w-24" />
        </div>
      </div>
    </section>
  );
}

export function NoteCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "radius-surface mx-auto w-full max-w-xl border border-border/80 bg-card p-2.5 shadow-card sm:p-3",
        className,
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading note"
    >
      <div className="radius-surface-inner relative overflow-hidden border border-brand-dark/25 bg-brand-mist p-5 sm:p-6">
        <div className="flex justify-end">
          <Skeleton className="radius-control h-6 w-24" />
        </div>
        <Skeleton className="radius-control mt-6 h-10 w-28" />
        <Skeleton className="mt-3 h-4 w-36" />
        <Skeleton className="mt-5 h-4 w-full max-w-xs" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 px-1">
        <Skeleton className="radius-control col-span-1 h-12 w-full" />
        <Skeleton className="radius-control col-span-2 h-12 w-full" />
      </div>
    </div>
  );
}

export function ClaimPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading claim"
    >
      <PageHeaderSkeleton titleW="w-24" subW="w-72" />
      <NoteCardSkeleton />
    </div>
  );
}

export function SendFormSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-lg"
      role="status"
      aria-busy="true"
      aria-label="Loading send form"
    >
      <div className="radius-surface overflow-hidden border border-border/80 bg-card p-2 shadow-card">
        <div className="radius-surface-inner border border-brand/15 bg-brand-mist px-6 py-6 text-center sm:px-8 sm:py-7">
          <Skeleton className="mx-auto h-3 w-36" />
          <Skeleton className="mx-auto mt-3 h-12 w-40 sm:h-14 sm:w-48" />
          <div className="mx-auto mt-4 flex justify-center gap-1.5">
            <Skeleton className="radius-control h-9 w-12" />
            <Skeleton className="radius-control h-9 w-12" />
            <Skeleton className="radius-control h-9 w-14" />
            <Skeleton className="radius-control h-9 w-14" />
          </div>
        </div>
        <div className="space-y-5 px-3 pb-3 pt-5 sm:px-4 sm:pb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <div className="flex flex-wrap gap-1.5">
              <Skeleton className="radius-control h-10 w-[5.5rem]" />
              <Skeleton className="radius-control h-10 w-24" />
              <Skeleton className="radius-control h-10 w-28" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="radius-control h-12 w-full" />
            <Skeleton className="radius-control h-10 w-full" />
          </div>
          <Skeleton className="radius-control h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

export function NoteRowSkeleton() {
  return (
    <div className="radius-surface border border-border/80 bg-card p-4 shadow-card">
      <Skeleton className="h-3 w-full max-w-xs" />
      <Skeleton className="mt-3 h-8 w-28" />
    </div>
  );
}

/** Table body rows for inbox-style loading. */
export function InboxTableRowsSkeleton({
  columns,
  rows = 3,
}: {
  columns: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border/40 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-5 py-3.5">
              <Skeleton
                className={cn(
                  "h-4",
                  c === columns - 1 ? "ml-auto w-16" : "w-20",
                  c === 0 && "w-16",
                  c === 1 && "w-28",
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function InboxMobileRowsSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="radius-control h-6 w-20" />
          </div>
          <Skeleton className="h-4 w-2/3 max-w-[12rem]" />
          <Skeleton className="radius-control h-10 w-full" />
        </li>
      ))}
    </>
  );
}

export function InboxSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading inbox"
    >
      <PageHeaderSkeleton titleW="w-28" subW="w-64" />
      <div className="relative">
        <div className="flex justify-center">
          <div className="inline-flex gap-1 rounded-full border border-border/80 bg-muted/60 p-1">
            <Skeleton className="radius-control h-10 w-[5.5rem]" />
            <Skeleton className="radius-control h-10 w-16" />
            <Skeleton className="radius-control h-10 w-20" />
          </div>
        </div>
        <Skeleton className="radius-control absolute right-0 top-1/2 hidden h-8 w-20 -translate-y-1/2 sm:block" />
      </div>
      <div className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
        <div className="hidden sm:block">
          <div className="flex gap-4 border-b border-border/60 bg-muted/80 px-5 py-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-12" />
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border/40 px-5 py-3.5 last:border-0"
            >
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="radius-control h-6 w-16" />
              <Skeleton className="radius-control ml-auto h-8 w-16" />
            </div>
          ))}
        </div>
        <ul className="divide-y divide-border/50 sm:hidden">
          <InboxMobileRowsSkeleton rows={2} />
        </ul>
      </div>
    </div>
  );
}

export function PrivacySkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-4"
      role="status"
      aria-busy="true"
      aria-label="Loading privacy"
    >
      <PageHeaderSkeleton titleW="w-32" subW="w-72" />
      <div className="mt-8 space-y-8 text-left">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6 max-w-sm" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}

export function LandingSkeleton() {
  return (
    <div
      className="mx-auto flex min-h-[calc(100svh-7rem)] w-full max-w-3xl flex-col items-center justify-center space-y-8 text-center"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="w-full space-y-4">
        <Skeleton className="mx-auto h-16 w-72 sm:h-20 sm:w-[28rem]" />
        <Skeleton className="mx-auto h-14 w-56 sm:h-20 sm:w-72" />
        <Skeleton className="mx-auto h-12 w-64 sm:h-16 sm:w-[22rem]" />
      </div>
      <Skeleton className="mx-auto h-5 w-full max-w-md" />
      <Skeleton className="radius-control mx-auto mt-2 h-14 w-full max-w-lg" />
      <div className="flex flex-wrap justify-center gap-2">
        <Skeleton className="radius-control h-11 w-40" />
        <Skeleton className="radius-control h-11 w-36" />
      </div>
    </div>
  );
}

export function AccountSkeleton({
  tab = "handles",
}: {
  tab?: "handles" | "wallet";
}) {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-0 text-center"
      role="status"
      aria-busy="true"
      aria-label="Loading account"
    >
      <PageHeaderSkeleton titleW="w-32 sm:w-36" subW="w-56 sm:w-64" />
      <div className="mt-8 text-left">
        <div className="mb-6 flex justify-center">
          <div className="inline-flex gap-1 rounded-full border border-border/80 bg-muted/60 p-1">
            <Skeleton className="radius-control h-9 w-[5.25rem]" />
            <Skeleton className="radius-control h-9 w-[4.75rem]" />
          </div>
        </div>
        {tab === "wallet" ? (
          <WalletPanelSkeleton />
        ) : (
          <HandlesPanelSkeleton />
        )}
      </div>
    </div>
  );
}

export function SendPageSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading send"
    >
      <PageHeaderSkeleton titleW="w-24" subW="w-72" />
      <div className="flex justify-center gap-2">
        <Skeleton className="radius-control h-10 w-20" />
        <Skeleton className="radius-control h-10 w-20" />
      </div>
      <SendFormSkeleton />
    </div>
  );
}

export function StatusSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-6"
      role="status"
      aria-busy="true"
      aria-label="Loading status"
    >
      <PageHeaderSkeleton titleW="w-24" subW="w-48" />
      <div className="radius-surface space-y-4 border border-border bg-card p-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    </div>
  );
}
