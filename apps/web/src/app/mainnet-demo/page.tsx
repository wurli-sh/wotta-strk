import { ExternalLink, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PageShell } from "@/components/PageShell";
import { PAGE_SUBTITLES } from "@/lib/brand-copy";
import mainnetDeployment from "../../../../../deployments/mainnet.json";

const actions = [
  {
    key: "shield",
    label: "Shield",
    detail: "0.1 payment plus Ready fee reserve → sender private balance",
    hash: process.env.NEXT_PUBLIC_MAINNET_SHIELD_TX_HASH,
    icon: ShieldCheck,
  },
  {
    key: "transfer",
    label: "Private transfer",
    detail: "0.1 private USDC → registered recipient",
    hash: process.env.NEXT_PUBLIC_MAINNET_TRANSFER_TX_HASH,
    icon: LockKeyhole,
  },
  {
    key: "withdraw",
    label: "Public withdrawal",
    detail: "0.1 private USDC → recipient Ready account",
    hash: process.env.NEXT_PUBLIC_MAINNET_WITHDRAW_TX_HASH,
    icon: Wallet,
  },
] as const;

function transactionUrl(hash: string): string {
  return `https://starkscan.co/tx/${hash}?network=mainnet`;
}

export default function MainnetDemoPage() {
  const managed = mainnetDeployment.walletManagedPrivacy;
  return (
    <PageShell title="Wotta on Mainnet" subtitle={PAGE_SUBTITLES.mainnetDemo} maxWidth="lg">
      <div className="space-y-4">
        <section className="radius-surface border border-warning-border bg-warning-surface p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">Starknet Mainnet</p>
              <h2 className="mt-1 text-lg font-semibold text-foreground">Ready wallet-managed private USDC</h2>
            </div>
            <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs font-semibold text-success">Live pool verified</span>
          </div>
          <p className="mt-4 break-all text-xs leading-5 text-muted-foreground">Pool {managed.poolAddress}</p>
          <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">Native USDC {managed.usdc}</p>
        </section>

        <ol className="space-y-3">
          {actions.map((action, index) => {
            const Icon = action.icon;
            return (
              <li key={action.key} className="radius-surface flex flex-col gap-4 border border-border/80 bg-card p-5 shadow-card sm:flex-row sm:items-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{index + 1}. {action.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{action.detail}</p>
                  {action.hash ? <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">{action.hash}</p> : null}
                </div>
                {action.hash ? (
                  <Button size="sm" variant="secondary" href={transactionUrl(action.hash)} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" aria-hidden /> Starkscan
                  </Button>
                ) : (
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Funding in progress</span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex justify-center pt-2">
          <Button href="/send">Open the demo</Button>
        </div>
      </div>
    </PageShell>
  );
}
