import Link from "next/link";
import { TRUTH_LINE } from "@/lib/brand-copy";

export function PrivacyCallout({ className }: { className?: string }) {
  return (
    <aside
      className={
        "rounded-xl border border-brand-muted/70 bg-brand-mist px-4 py-3 text-sm leading-relaxed text-brand-ink " +
        (className ?? "")
      }
      data-testid="privacy-callout"
    >
      <p className="font-semibold">Source is public. Balance is private.</p>
      <p className="mt-1 text-brand-ink/80">
        {TRUTH_LINE}{" "}
        <Link href="/privacy" className="font-medium underline underline-offset-4">
          Details
        </Link>
      </p>
    </aside>
  );
}
