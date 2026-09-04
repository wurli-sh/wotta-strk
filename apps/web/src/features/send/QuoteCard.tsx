"use client";

import { formatUsdc } from "@/lib/format/amount";
import { QUOTE_PRIVACY_NOTE } from "@/lib/brand-copy";

type Props = {
  grossDebit?: bigint | null;
  maxFee?: bigint | null;
  finality?: number | null;
  expiry?: string | null;
  privacyNote?: string;
};

export function QuoteCard({
  grossDebit,
  maxFee,
  finality,
  expiry,
  privacyNote = QUOTE_PRIVACY_NOTE,
}: Props) {
  if (grossDebit == null) return null;
  return (
    <div className="radius-surface-inner space-y-2 border border-border/70 bg-brand-mist/40 px-4 py-3 text-left text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">You send</span>
        <span className="font-medium">{formatUsdc(grossDebit)} USDC</span>
      </div>
      {maxFee != null ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Max fee</span>
          <span>{formatUsdc(maxFee)} USDC</span>
        </div>
      ) : null}
      {finality != null ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Finality</span>
          <span>{finality}</span>
        </div>
      ) : null}
      {expiry ? (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Claim expires</span>
          <span className="text-xs">{expiry}</span>
        </div>
      ) : null}
      <p className="pt-1 text-xs text-muted-foreground">{privacyNote}</p>
    </div>
  );
}
