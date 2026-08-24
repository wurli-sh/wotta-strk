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
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { createClient } from "@/lib/supabase/client";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import {
  clearAllPrivacyVaultLocalState,
  restorePrivacyVaultFromSession,
  unlockPrivacyVault,
  type PrivacyVault,
} from "@/lib/wotta/privacy-state";
import { connectReady } from "@/lib/wotta/ready";
import { NETWORK_MODE_EVENT } from "@/lib/network-mode";

type PrivacyVaultContextValue = {
  vault: PrivacyVault | null;
  unlocking: boolean;
  /** False until a tab-session restore attempt finishes. */
  sessionReady: boolean;
  unlock: () => Promise<PrivacyVault>;
  clearVault: () => void;
};

const PrivacyVaultContext = createContext<PrivacyVaultContextValue | null>(null);

export function PrivacyVaultProvider({ children }: { children: ReactNode }) {
  const [vault, setVault] = useState<PrivacyVault | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const me = await apiFetch<MeResponse>("/v1/me", { token });
        if (!me.wallet?.address) return;
        const restored = await restorePrivacyVaultFromSession(
          me.wallet.address,
          directPrivacyConfig(),
        );
        if (restored) setVault(restored);
      } catch {
        // Ignore restore errors — user can unlock manually.
      } finally {
        setSessionReady(true);
      }
    })();
  }, []);

  const unlock = useCallback(async () => {
    setUnlocking(true);
    try {
      const connected = await connectReady();
      const next = await unlockPrivacyVault(connected.account, directPrivacyConfig());
      setVault(next);
      return next;
    } finally {
      setUnlocking(false);
    }
  }, []);

  const clearVault = useCallback(() => {
    setVault(null);
    clearAllPrivacyVaultLocalState();
  }, []);

  useEffect(() => {
    const onMode = (event: Event) => {
      const next = (event as CustomEvent<"testnet" | "mainnet">).detail;
      setVault(null);
      if (next !== "testnet") return;
      void (async () => {
        try {
          const { data } = await createClient().auth.getSession();
          const token = data.session?.access_token;
          if (!token) return;
          const me = await apiFetch<MeResponse>("/v1/me", { token, network: "testnet" });
          if (!me.wallet?.address) return;
          const restored = await restorePrivacyVaultFromSession(
            me.wallet.address,
            directPrivacyConfig(),
          );
          if (restored) setVault(restored);
        } catch {
          // Ignore restore errors — user can unlock manually.
        }
      })();
    };
    window.addEventListener(NETWORK_MODE_EVENT, onMode);
    return () => window.removeEventListener(NETWORK_MODE_EVENT, onMode);
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
