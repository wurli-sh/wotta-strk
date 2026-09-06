import { publicKeyFromSecret } from "@wotta/crypto";
import type { WalletAccountV6 } from "starknet";
import type { NetworkMode } from "@/lib/network-mode";
import { chainIdForNetwork, deriveInboxKeyPair } from "@/lib/wotta/inbox-key-derive";
import type { PrivacyVault } from "@/lib/wotta/privacy-state";
import { createBrowserProductSession } from "@/lib/wotta/product-session";

function secretMatchesPublished(
  secret: string | undefined,
  published: string,
): boolean {
  if (!secret) return false;
  try {
    return publicKeyFromSecret(secret) === published;
  } catch {
    return false;
  }
}

/**
 * Claim needs the X25519 inbox secret that was published at wallet link time.
 * Unlock alone only restores the viewing-key vault. Prefer re-deriving from Ready
 * when the published pubkey is wallet-backed; never invent a new key for an
 * existing binding.
 */
export async function ensureClaimInboxKey(
  vault: PrivacyVault,
  account: WalletAccountV6,
  mode: NetworkMode,
): Promise<{ rebound: boolean }> {
  const session = createBrowserProductSession();
  const me = await session.me();
  const expected = me.wallet?.inbox_pubkey;

  // Unbound profiles must link even if a stale vault secret remains.
  if (expected && secretMatchesPublished(vault.state.inboxSecretKey, expected)) {
    return { rebound: false };
  }

  if (expected) {
    const derived = await deriveInboxKeyPair(account, chainIdForNetwork(mode));
    if (derived.publicKey === expected) {
      await vault.setInboxSecretKey(derived.secretKey);
      return { rebound: false };
    }
    throw new Error(
      "This browser can’t decrypt your inbox — the Ready link’s secret isn’t available here. Use the browser that originally linked Ready for older payments, or upgrade the inbox key from Account (older notes stay sealed to the previous key).",
    );
  }

  await session.bindReadyAndIdentity(account, vault);
  if (!vault.state.inboxSecretKey) {
    throw new Error("This browser has no Wotta inbox key");
  }
  return { rebound: true };
}
