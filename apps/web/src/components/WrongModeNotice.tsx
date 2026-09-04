"use client";

import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { toastNetworkModeEnabled } from "@/lib/network-mode-toast";
import { TOAST } from "@/lib/brand-copy";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { useGlimmSweep } from "@/lib/useGlimmSweep";
import { Button } from "@/components/ui/Button";

export function WrongModeNotice({
  feature,
  detail,
  mainnetHref = "/send",
  mainnetLabel = "Go to Mainnet Send",
}: {
  feature: string;
  detail?: string;
  mainnetHref?: string;
  mainnetLabel?: string;
}) {
  const { setMode } = useNetworkMode();
  const playSweep = useGlimmSweep();

  function switchToTestnet() {
    if (!setMode("testnet")) {
      toast.error(TOAST.networkBlocked);
      return;
    }
    playSweep(true);
    toastNetworkModeEnabled("testnet");
  }

  return (
    <section className="radius-surface border border-warning-border bg-warning-surface p-6 text-center shadow-card" role="status">
      <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-warning-border bg-card text-warning">
        <AlertTriangle className="size-5" aria-hidden />
      </span>
      <h2 className="mt-4 text-base font-semibold text-foreground">{feature} is not available on Mainnet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {detail ?? `Switch to Testnet, or use the registered private flow on Mainnet.`}
      </p>
      <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
        <Button onClick={switchToTestnet}>Switch to Testnet</Button>
        <Button variant="outline" href={mainnetHref}>{mainnetLabel}</Button>
      </div>
    </section>
  );
}
