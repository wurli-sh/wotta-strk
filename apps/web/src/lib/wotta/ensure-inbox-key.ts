import { publicKeyFromSecret } from "@wotta/crypto";
import type { WalletAccountV6 } from "starknet";
import type { NetworkMode } from "@/lib/network-mode";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { mainnetPrivacyConfig } from "@/lib/wotta/mainnet-privacy";
import {
  restorePrivacyVaultFromSession,
  unlockPrivacyVault,
  type PrivacyVault,
} from "@/lib/wotta/privacy-state";
import { createBrowserProductSession } from "@/lib/wotta/product-session";

function otherUnlockConfig(mode: NetworkMode) {
  return mode === "mainnet" ? directPrivacyConfig() : mainnetPrivacyConfig();
}

/**
 * Claim needs the X25519 inbox secret that was published at wallet link time.
 * Unlock alone only restores the viewing-key vault — if this network's vault
 * never stored the secret, try the other network's vault before re-linking.
 */
export async function ensureClaimInboxKey(
  vault: PrivacyVault,
  account: WalletAccountV6,
  mode: NetworkMode,
): Promise<{ rebound: boolean }> {
  const session = createBrowserProductSession();
  const me = await session.me();
  const expected = me.wallet?.inbox_pubkey;

  const matches = (secret: string | undefined) =>
    Boolean(secret && (!expected || publicKeyFromSecret(secret) === expected));

  if (matches(vault.state.inboxSecretKey)) {
    return { rebound: false };
  }

  const other = otherUnlockConfig(mode);
  try {
    let donor = await restorePrivacyVaultFromSession(account.address, other);
    if (!donor?.state.inboxSecretKey) {
      donor = await unlockPrivacyVault(account, other);
    }
    if (matches(donor.state.inboxSecretKey)) {
      await vault.setInboxSecretKey(donor.state.inboxSecretKey!);
      return { rebound: false };
    }
  } catch {
    // Fall through to re-link when the other vault is unavailable.
  }

  if (me.wallet?.inbox_pubkey) {
    throw new Error(
      "This browser can’t decrypt your inbox — the Ready link’s secret isn’t on this device. Use the browser that originally linked Ready, or unlink and re-link from Account (older payments won’t open after re-link).",
    );
  }

  await session.bindReadyAndIdentity(account, vault);
  if (!vault.state.inboxSecretKey) {
    throw new Error("This browser has no Wotta inbox key");
  }
  return { rebound: true };
}
