"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  NETWORK_MODE_EVENT,
  NETWORK_MODE_STORAGE_KEY,
  readNetworkMode,
  type NetworkMode,
} from "@/lib/network-mode";
import { prepareNetworkSwitch } from "@/lib/network-operations";

type NetworkModeContextValue = {
  mode: NetworkMode;
  /** False until localStorage mode has been applied after mount (SSR-safe). */
  ready: boolean;
  setMode: (mode: NetworkMode) => boolean;
};

const NetworkModeContext = createContext<NetworkModeContextValue | null>(null);

export function NetworkModeProvider({ children }: { children: ReactNode }) {
  // Always start as testnet so SSR and the first client paint match.
  const [mode, setModeState] = useState<NetworkMode>("testnet");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setModeState(readNetworkMode());
    sync();
    setReady(true);
    window.addEventListener(NETWORK_MODE_EVENT, sync);
    return () => window.removeEventListener(NETWORK_MODE_EVENT, sync);
  }, []);

  const setMode = useCallback((next: NetworkMode) => {
    if (next === readNetworkMode()) return true;
    if (!prepareNetworkSwitch().allowed) return false;
    window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, next);
    setModeState(next);
    window.dispatchEvent(new CustomEvent(NETWORK_MODE_EVENT, { detail: next }));
    return true;
  }, []);

  const value = useMemo(() => ({ mode, ready, setMode }), [mode, ready, setMode]);
  return <NetworkModeContext.Provider value={value}>{children}</NetworkModeContext.Provider>;
}

export function useNetworkMode(): NetworkModeContextValue {
  const value = useContext(NetworkModeContext);
  if (!value) throw new Error("useNetworkMode must be used within NetworkModeProvider");
  return value;
}
