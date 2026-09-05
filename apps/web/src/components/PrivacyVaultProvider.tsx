"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { AUTH_SESSION_EVENT } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";
import {
  inboxLinkWarning,
  validateInboxBinding,
  type InboxLinkStatus,
} from "@/lib/wotta/inbox-binding";
import { privacyVaultUnlockConfig } from "@/lib/wotta/privacy-vault-config";
import {
  clearAllPrivacyVaultLocalState,
  restorePrivacyVaultFromSession,
  unlockPrivacyVault,
  type PrivacyVault,
} from "@/lib/wotta/privacy-state";
import { clearReadyConnections, connectReady, peekReadyConnection } from "@/lib/wotta/ready";
import { toast } from "sonner";

type PrivacyVaultContextValue = {
  vault: PrivacyVault | null;
  unlocking: boolean;
  /** False until a tab-session restore attempt finishes. */
  sessionReady: boolean;
  /** Passive, network-scoped check of the server binding against this tab. */
  inboxLinkStatus: InboxLinkStatus;
  unlock: () => Promise<{ vault: PrivacyVault; account: Awaited<ReturnType<typeof connectReady>>["account"] }>;
  clearVault: () => void;
};

const PrivacyVaultContext = createContext<PrivacyVaultContextValue | null>(null);

export function PrivacyVaultProvider({ children }: { children: ReactNode }) {
  const { mode, ready: networkReady } = useNetworkMode();
  const [vault, setVault] = useState<PrivacyVault | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [inboxLinkStatus, setInboxLinkStatus] = useState<InboxLinkStatus>("checking");
  const [sessionRevision, setSessionRevision] = useState(0);
  const warnedRef = useRef<string | null>(null);

  useEffect(() => {
    const refresh = () => setSessionRevision((value) => value + 1);
    window.addEventListener(AUTH_SESSION_EVENT, refresh);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, refresh);
  }, []);

  useEffect(() => {
    let active = true;
    setVault(null);
    setSessionReady(false);
    setInboxLinkStatus("checking");
    if (!networkReady) {
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          if (active) setInboxLinkStatus("signed_out");
          return;
        }
        const me = await apiFetch<MeResponse>("/v1/me", { token, network: mode });
        if (!me.wallet?.address) {
          if (active) setInboxLinkStatus("unlinked");
          return;
        }
        const restored = await restorePrivacyVaultFromSession(
          me.wallet.address,
          privacyVaultUnlockConfig(mode),
        );
        if (active) {
          if (restored) setVault(restored);
          setInboxLinkStatus(validateInboxBinding(
            me.wallet,
            restored?.state.inboxSecretKey,
            peekReadyConnection(mode)?.address,
          ));
        }
      } catch (error) {
        if (active && error instanceof Error && error.message.includes("network_mode_mismatch")) {
          setInboxLinkStatus("network_mismatch");
        }
      } finally {
        if (active) setSessionReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, networkReady, sessionRevision]);

  useEffect(() => {
    const warning = inboxLinkWarning(mode, inboxLinkStatus);
    const toastId = `inbox-link-${mode}`;
    if (!warning) {
      toast.dismiss(toastId);
      warnedRef.current = null;
      return;
    }
    const warningKey = `${mode}:${inboxLinkStatus}`;
    if (warnedRef.current === warningKey) return;
    warnedRef.current = warningKey;
    const options = { id: toastId, duration: 8_000 };
    if (["key_mismatch", "wrong_wallet", "network_mismatch"].includes(inboxLinkStatus)) {
      toast.error(warning, options);
    } else {
      toast.warning(warning, options);
    }
  }, [inboxLinkStatus, mode]);

  const unlock = useCallback(async () => {
    if (!networkReady) throw new Error("Network selection is still loading");
    setUnlocking(true);
    try {
      const connected = await connectReady(mode);
      const next = await unlockPrivacyVault(connected.account, privacyVaultUnlockConfig(mode));
      setVault(next);
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        const me = await apiFetch<MeResponse>("/v1/me", { token, network: mode });
        setInboxLinkStatus(validateInboxBinding(me.wallet, next.state.inboxSecretKey, connected.address));
      }
      return { vault: next, account: connected.account };
    } finally {
      setUnlocking(false);
    }
  }, [mode, networkReady]);

  const clearVault = useCallback(() => {
    setVault(null);
    setInboxLinkStatus("checking");
    clearReadyConnections();
    clearAllPrivacyVaultLocalState();
  }, []);

  const value = useMemo(
    () => ({ vault, unlocking, sessionReady, inboxLinkStatus, unlock, clearVault }),
    [vault, unlocking, sessionReady, inboxLinkStatus, unlock, clearVault],
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
