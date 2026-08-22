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

export function SourceWalletProvider({ children }: { children: ReactNode }) {
  const [byChain, setByChain] = useState<SourcesMap>({});

  useEffect(() => {
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

  const getSource = useCallback(
    (routeKey: SourceRail) => byChain[chainKeyForRoute(routeKey)] ?? null,
    [byChain],
  );

  const matchesRoute = useCallback(
    (routeKey: SourceRail) => {
      const wallet = getSource(routeKey);
      if (!wallet) return false;
      const chain = chainKeyForRoute(routeKey);
      // Starknet public/private share one Ready wallet slot.
      if (chain === "starknet") return wallet.family === "starknet";
      // Exact rail only — connecting Base must not unlock Ethereum Send.
      return wallet.chainKey === chain && wallet.routeKey === routeKey;
    },
    [getSource],
  );

  const sources = useMemo(() => orderedSources(byChain), [byChain]);

  const value = useMemo(
    () => ({ sources, setSource, clearSources, getSource, matchesRoute }),
    [sources, setSource, clearSources, getSource, matchesRoute],
  );

  return <SourceWalletContext.Provider value={value}>{children}</SourceWalletContext.Provider>;
}

export function useSourceWallet() {
  const value = useContext(SourceWalletContext);
  if (!value) throw new Error("useSourceWallet requires SourceWalletProvider");
  return value;
}
