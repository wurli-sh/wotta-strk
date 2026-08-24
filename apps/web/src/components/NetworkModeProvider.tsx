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
  setMode: (mode: NetworkMode) => boolean;
};

const NetworkModeContext = createContext<NetworkModeContextValue | null>(null);

export function NetworkModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>("testnet");

  useEffect(() => setModeState(readNetworkMode()), []);

  const setMode = useCallback((next: NetworkMode) => {
    if (next === readNetworkMode()) return true;
    if (!prepareNetworkSwitch().allowed) return false;
    window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, next);
    setModeState(next);
    window.dispatchEvent(new CustomEvent(NETWORK_MODE_EVENT, { detail: next }));
    return true;
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <NetworkModeContext.Provider value={value}>{children}</NetworkModeContext.Provider>;
}

export function useNetworkMode(): NetworkModeContextValue {
  const value = useContext(NetworkModeContext);
  if (!value) throw new Error("useNetworkMode must be used within NetworkModeProvider");
  return value;
}
