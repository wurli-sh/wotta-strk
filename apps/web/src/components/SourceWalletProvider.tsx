"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SourceRail } from "@/components/SourceChips";

export type ConnectedSourceWallet = {
  routeKey: SourceRail;
  family: "evm" | "solana" | "stellar" | "starknet";
  address: string;
  label?: string;
  icon?: string;
};

type SourceWalletContextValue = {
  sources: ConnectedSourceWallet[];
  setSource: (wallet: ConnectedSourceWallet) => void;
  clearSources: () => void;
};

const SourceWalletContext = createContext<SourceWalletContextValue | null>(null);

export function SourceWalletProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<ConnectedSourceWallet[]>([]);
  const setSource = useCallback((wallet: ConnectedSourceWallet) => {
    setSources((current) => [
      ...current.filter((item) => item.routeKey !== wallet.routeKey),
      wallet,
    ]);
  }, []);
  const clearSources = useCallback(() => setSources([]), []);
  const value = useMemo(
    () => ({ sources, setSource, clearSources }),
    [clearSources, setSource, sources],
  );
  return <SourceWalletContext.Provider value={value}>{children}</SourceWalletContext.Provider>;
}

export function useSourceWallet() {
  const value = useContext(SourceWalletContext);
  if (!value) throw new Error("useSourceWallet requires SourceWalletProvider");
  return value;
}
