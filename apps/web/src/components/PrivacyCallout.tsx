export function PrivacyCallout({ className }: { className?: string }) {
  return (
    <aside
      className={
        "rounded-xl border border-brand-muted/70 bg-brand-mist px-4 py-3 text-sm leading-relaxed text-brand-ink " +
        (className ?? "")
      }
      data-testid="privacy-callout"
    >
      <p className="font-semibold">Privacy in one line</p>
      <p className="mt-1 text-brand-ink/80">
        Wotta keeps note payloads encrypted and uses Stark proofs for private
        pool actions. Source-chain burns, Starknet transactions, amounts, and
        timing remain public on testnet.
      </p>
    </aside>
  );
}
