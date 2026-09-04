import type { NetworkMode } from "@/lib/network-mode";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { mainnetPrivacyConfig } from "@/lib/wotta/mainnet-privacy";

/** Pool-bound vault unlock config for the active product network. */
export function privacyVaultUnlockConfig(mode: NetworkMode): {
  chainId: "SN_MAIN" | "SN_SEPOLIA";
  poolAddress: string;
} {
  return mode === "mainnet" ? mainnetPrivacyConfig() : directPrivacyConfig();
}
