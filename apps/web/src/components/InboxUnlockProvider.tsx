"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "swoop:inbox-unlock-v1";

type InboxUnlockContextValue = {
  privKey: Uint8Array | null;
  setPrivKey: (key: Uint8Array | null) => void;
  clearUnlock: () => void;
};

const InboxUnlockContext = createContext<InboxUnlockContextValue | null>(null);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function readStoredKey(): Uint8Array | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const bytes = base64ToBytes(raw);
    return bytes && bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function writeStoredKey(key: Uint8Array | null) {
  if (typeof window === "undefined") return;
  try {
    if (!key) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, bytesToBase64(key));
  } catch {
    // sessionStorage may be unavailable
  }
}

export function InboxUnlockProvider({ children }: { children: ReactNode }) {
  const [privKey, setPrivKeyState] = useState<Uint8Array | null>(() => readStoredKey());

  const setPrivKey = useCallback((key: Uint8Array | null) => {
    setPrivKeyState(key);
    writeStoredKey(key);
  }, []);

  const clearUnlock = useCallback(() => {
    setPrivKeyState(null);
    writeStoredKey(null);
  }, []);

  const value = useMemo(
    () => ({ privKey, setPrivKey, clearUnlock }),
    [privKey, setPrivKey, clearUnlock],
  );

  return (
    <InboxUnlockContext.Provider value={value}>{children}</InboxUnlockContext.Provider>
  );
}

export function useInboxUnlock(): InboxUnlockContextValue {
  const ctx = useContext(InboxUnlockContext);
  if (!ctx) {
    throw new Error("useInboxUnlock must be used within InboxUnlockProvider");
  }
  return ctx;
}

/** Safe clear for nav / sign-out outside of provider consumers. */
export function clearInboxUnlockStorage() {
  writeStoredKey(null);
}
