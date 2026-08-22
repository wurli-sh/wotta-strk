"use client";

import { Shield } from "lucide-react";

const BULLETS = [
  "Inbox private keys stay on this device — losing the device loses claim decryption.",
  "Claim and refund secrets are generated before source submission; treat recovery data like cash.",
  "Private balance discovery and proofs require the encrypted viewing key plus Ready authorization.",
  "Every wallet link is scoped to Starknet Sepolia, this origin, and the current profile.",
];

export function SecurityPanel() {
  return (
    <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
          <Shield className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Security</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What stays private, and what you must protect.
          </p>
        </div>
      </div>
      <div className="space-y-3 p-5 sm:p-6 text-sm">
        <ul className="list-disc space-y-2 pl-5 text-xs text-muted-foreground">
          {BULLETS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          See the{" "}
          <a className="underline" href="/privacy">
            privacy page
          </a>{" "}
          for the full trust model — including what stays public.
        </p>
      </div>
    </section>
  );
}
