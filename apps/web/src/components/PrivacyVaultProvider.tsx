"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";
import { privacyVaultUnlockConfig } from "@/lib/wotta/privacy-vault-config";
import {
  clearAllPrivacyVaultLocalState,
  restorePrivacyVaultFromSession,
  unlockPrivacyVault,
  type PrivacyVault,
} from "@/lib/wotta/privacy-state";
import { clearReadyConnections, connectReady } from "@/lib/wotta/ready";

type PrivacyVaultContextValue = {
  vault: PrivacyVault | null;
  unlocking: boolean;
  /** False until a tab-session restore attempt finishes. */
  sessionReady: boolean;
  unlock: () => Promise<{ vault: PrivacyVault; account: Awaited<ReturnType<typeof connectReady>>["account"] }>;
  clearVault: () => void;
};

const PrivacyVaultContext = createContext<PrivacyVaultContextValue | null>(null);

export function PrivacyVaultProvider({ children }: { children: ReactNode }) {
  const { mode, ready: networkReady } = useNetworkMode();
  const [vault, setVault] = useState<PrivacyVault | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    setVault(null);
    setSessionReady(false);
    if (!networkReady) {
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const me = await apiFetch<MeResponse>("/v1/me", { token, network: mode });
        if (!me.wallet?.address) return;
        const restored = await restorePrivacyVaultFromSession(
          me.wallet.address,
          privacyVaultUnlockConfig(mode),
        );
        if (active && restored) setVault(restored);
      } catch {
        // Ignore restore errors — user can unlock manually.
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, networkReady]);

  const unlock = useCallback(async () => {
    if (!networkReady) throw new Error("Network selection is still loading");
    setUnlocking(true);
    try {
      const connected = await connectReady(mode);
      const next = await unlockPrivacyVault(connected.account, privacyVaultUnlockConfig(mode));
      setVault(next);
      return { vault: next, account: connected.account };
    } finally {
      setUnlocking(false);
    }
  }, [mode, networkReady]);

  const clearVault = useCallback(() => {
    setVault(null);
    clearReadyConnections();
    clearAllPrivacyVaultLocalState();
  }, []);

  const value = useMemo(
    () => ({ vault, unlocking, sessionReady, unlock, clearVault }),
    [vault, unlocking, sessionReady, unlock, clearVault],
  );

  return (
    <PrivacyVaultContext.Provider value={value}>{children}</PrivacyVaultContext.Provider>
  );
}

export function usePrivacyVault(): PrivacyVaultContextValue {
  const ctx = useContext(PrivacyVaultContext);
  if (!ctx) {
    throw new Error("usePrivacyVault must be used within PrivacyVaultProvider");
  }
  return ctx;
}
