import { toast } from "sonner";
import { TOAST } from "@/lib/brand-copy";
import type { NetworkMode } from "@/lib/network-mode";

export function toastNetworkModeEnabled(mode: NetworkMode) {
  const mainnet = mode === "mainnet";
  toast.success(mainnet ? TOAST.switchedMainnet : TOAST.switchedTestnet, {
    classNames: {
      toast: mainnet ? "toast-network-mainnet" : "toast-network-testnet",
      title: mainnet ? "toast-network-mainnet-title" : "toast-network-testnet-title",
    },
  });
}
