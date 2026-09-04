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
import {
  sourceChipKey,
  type SourceChipKey,
  type SourceRail,
} from "@/components/SourceChips";
import { NETWORK_MODE_EVENT } from "@/lib/network-mode";

export type ConnectedSourceWallet = {
  routeKey: SourceRail;
  family: "evm" | "solana" | "stellar" | "starknet";
  address: string;
  label?: string;
  icon?: string;
  /** Display/storage chain key — ethereum, base, arbitrum, solana, stellar, starknet. */
  chainKey: SourceChipKey;
};

type SourcesMap = Partial<Record<SourceChipKey, ConnectedSourceWallet>>;

type SourceWalletContextValue = {
  sources: ConnectedSourceWallet[];
  setSource: (wallet: Omit<ConnectedSourceWallet, "chainKey"> & { chainKey?: SourceChipKey }) => void;
  clearSources: () => void;
  clearSource: (chainKey: SourceChipKey) => void;
  getSource: (routeKey: SourceRail) => ConnectedSourceWallet | null;
  matchesRoute: (routeKey: SourceRail) => boolean;
};

const STORAGE_KEY = "wotta:source-wallets";

const CHAIN_ORDER: SourceChipKey[] = [
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
  "starknet",
];

const EVM_CHAIN_KEYS = new Set<SourceChipKey>(["ethereum", "arbitrum", "base"]);

const SourceWalletContext = createContext<SourceWalletContextValue | null>(null);

export function chainKeyForRoute(routeKey: SourceRail): SourceChipKey {
  return sourceChipKey(routeKey);
}

export function familyForRoute(routeKey: SourceRail): ConnectedSourceWallet["family"] {
  if (routeKey === "solana") return "solana";
  if (routeKey === "stellar") return "stellar";
  if (routeKey === "starknet-public" || routeKey === "starknet-private") return "starknet";
  return "evm";
}

function isWallet(value: unknown): value is ConnectedSourceWallet {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as ConnectedSourceWallet;
  return Boolean(
    candidate.routeKey
      && candidate.family
      && typeof candidate.address === "string"
      && candidate.address.length > 0
      && candidate.chainKey,
  );
}

function normalizeMap(raw: SourcesMap): SourcesMap {
  const next: SourcesMap = {};
  for (const key of CHAIN_ORDER) {
    const wallet = raw[key];
    if (wallet && isWallet(wallet)) next[key] = wallet;
  }
  return next;
}

function readStored(): SourcesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SourcesMap | ConnectedSourceWallet[];
    // Migrate older family-keyed or array shapes by rebuilding from wallets.
    if (Array.isArray(parsed)) {
      const map: SourcesMap = {};
      for (const wallet of parsed) {
        if (!isWallet(wallet)) continue;
        map[wallet.chainKey ?? chainKeyForRoute(wallet.routeKey)] = {
          ...wallet,
          chainKey: wallet.chainKey ?? chainKeyForRoute(wallet.routeKey),
        };
      }
      return normalizeMap(map);
    }
    // Legacy family keys (evm/solana/…) — remap if present.
    const legacy = parsed as Record<string, ConnectedSourceWallet>;
    if (legacy.evm && !legacy.ethereum && !legacy.base && !legacy.arbitrum) {
      const wallet = legacy.evm;
      const chain = chainKeyForRoute(wallet.routeKey);
      return normalizeMap({
        [chain]: { ...wallet, chainKey: chain, family: wallet.family ?? "evm" },
      });
    }
    return normalizeMap(parsed as SourcesMap);
  } catch {
    return {};
  }
}

function writeStored(next: SourcesMap) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(next).length === 0) {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function orderedSources(map: SourcesMap): ConnectedSourceWallet[] {
  return CHAIN_ORDER.flatMap((key) => {
    const wallet = map[key];
    return wallet ? [wallet] : [];
  });
}

type Eip1193 = {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

type PhantomProvider = {
  publicKey?: { toBase58(): string } | null;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  off?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
};

function injectedEvm(): Eip1193 | undefined {
  return (globalThis as typeof globalThis & { ethereum?: Eip1193 }).ethereum;
}

function injectedPhantom(): PhantomProvider | undefined {
  return (globalThis as typeof globalThis & { phantom?: { solana?: PhantomProvider } }).phantom?.solana
    ?? (globalThis as typeof globalThis & { solana?: PhantomProvider }).solana;
}

export function SourceWalletProvider({ children }: { children: ReactNode }) {
  const [byChain, setByChain] = useState<SourcesMap>({});

  useEffect(() => {
    // Persisted wallets are a reconnect hint only — live listeners may clear them.
    setByChain(readStored());
  }, []);

  const setSource = useCallback((
    wallet: Omit<ConnectedSourceWallet, "chainKey"> & { chainKey?: SourceChipKey },
  ) => {
    const chainKey = wallet.chainKey ?? chainKeyForRoute(wallet.routeKey);
    const family = wallet.family || familyForRoute(wallet.routeKey);
    const nextWallet: ConnectedSourceWallet = { ...wallet, family, chainKey };
    setByChain((prev) => {
      const updated = { ...prev, [chainKey]: nextWallet };
      writeStored(updated);
      return updated;
    });
  }, []);

  const clearSources = useCallback(() => {
    writeStored({});
    setByChain({});
  }, []);

  const clearSource = useCallback((chainKey: SourceChipKey) => {
    setByChain((prev) => {
      if (!prev[chainKey]) return prev;
      const updated = { ...prev };
      delete updated[chainKey];
      writeStored(updated);
      return updated;
    });
  }, []);

  useEffect(() => {
    window.addEventListener(NETWORK_MODE_EVENT, clearSources);
    return () => window.removeEventListener(NETWORK_MODE_EVENT, clearSources);
  }, [clearSources]);

  useEffect(() => {
    const provider = injectedEvm();
    if (!provider?.on || !provider.removeListener) return;

    const onAccountsChanged = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      const active = list[0]?.toLowerCase();
      setByChain((prev) => {
        let changed = false;
        const updated = { ...prev };
        for (const key of EVM_CHAIN_KEYS) {
          const wallet = updated[key];
          if (!wallet) continue;
          if (!active || wallet.address.toLowerCase() !== active) {
            delete updated[key];
            changed = true;
          }
        }
        if (!changed) return prev;
        writeStored(updated);
        return updated;
      });
    };

    const onChainChanged = () => {
      // Chain switches invalidate EVM source readiness; user must reconnect/ensureChain.
      setByChain((prev) => {
        let changed = false;
        const updated = { ...prev };
        for (const key of EVM_CHAIN_KEYS) {
          if (updated[key]) {
            delete updated[key];
            changed = true;
          }
        }
        if (!changed) return prev;
        writeStored(updated);
        return updated;
      });
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  useEffect(() => {
    const provider = injectedPhantom();
    if (!provider?.on) return;

    const clearSolana = () => clearSource("solana");
    const onAccountChanged = (publicKey: unknown) => {
      if (!publicKey) {
        clearSolana();
        return;
      }
      const next = typeof publicKey === "object" && publicKey && "toBase58" in publicKey
        ? String((publicKey as { toBase58(): string }).toBase58())
        : null;
      setByChain((prev) => {
        const wallet = prev.solana;
        if (!wallet) return prev;
        if (!next || wallet.address !== next) {
          const updated = { ...prev };
          delete updated.solana;
          writeStored(updated);
          return updated;
        }
        return prev;
      });
    };

    provider.on("accountChanged", onAccountChanged);
    provider.on("disconnect", clearSolana);
    return () => {
      provider.off?.("accountChanged", onAccountChanged);
      provider.off?.("disconnect", clearSolana);
      provider.removeListener?.("accountChanged", onAccountChanged);
      provider.removeListener?.("disconnect", clearSolana);
    };
  }, [clearSource]);

  const getSource = useCallback(
    (routeKey: SourceRail) => byChain[chainKeyForRoute(routeKey)] ?? null,
    [byChain],
  );

  const matchesRoute = useCallback(
    (routeKey: SourceRail) => getSource(routeKey)?.routeKey === routeKey,
    [getSource],
  );

  const sources = useMemo(() => orderedSources(byChain), [byChain]);

  const value = useMemo(
    () => ({ sources, setSource, clearSources, clearSource, getSource, matchesRoute }),
    [sources, setSource, clearSources, clearSource, getSource, matchesRoute],
  );

  return <SourceWalletContext.Provider value={value}>{children}</SourceWalletContext.Provider>;
}

export function useSourceWallet() {
  const value = useContext(SourceWalletContext);
  if (!value) throw new Error("useSourceWallet requires SourceWalletProvider");
  return value;
}
