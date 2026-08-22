const METAMASK_INSTALL = "https://metamask.io/download/";
const PHANTOM_INSTALL = "https://phantom.app/download";
const FREIGHTER_INSTALL = "https://www.freighter.app/";

function openInstall(url: string): void {
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function hasInjectedEvmWallet(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as typeof window & { ethereum?: unknown }).ethereum,
  );
}

export function hasPhantomWallet(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as typeof window & { phantom?: { solana?: { isPhantom?: boolean } } })
      .phantom?.solana?.isPhantom,
  );
}

export async function hasFreighterWallet(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const freighter = await import("@stellar/freighter-api");
    const api = (freighter as { default?: typeof freighter } & typeof freighter)
      .default ?? freighter;
    if (typeof api.isConnected !== "function") return false;
    const result = await api.isConnected();
    if (!result || typeof result !== "object") return false;
    if ("error" in result && result.error) return false;
    return Boolean(
      "isConnected" in result && (result as { isConnected?: boolean }).isConnected,
    );
  } catch {
    return false;
  }
}

/** Toast-friendly message when wallet extension is missing; also opens install page. */
export function requireOrInstallEvmWallet(): void {
  if (hasInjectedEvmWallet()) return;
  openInstall(METAMASK_INSTALL);
  throw new Error("Install or unlock an EVM wallet");
}

export function requireOrInstallPhantom(): void {
  if (hasPhantomWallet()) return;
  openInstall(PHANTOM_INSTALL);
  throw new Error("Install or unlock Phantom to pay from Solana");
}

export async function requireOrInstallFreighter(): Promise<void> {
  if (await hasFreighterWallet()) return;
  openInstall(FREIGHTER_INSTALL);
  throw new Error("Install or unlock Freighter to pay from Stellar");
}

export function openEvmWalletInstall() {
  openInstall(METAMASK_INSTALL);
}

/** Ensure the right browser extension is present before CCTP source connect. */
export async function requireSourceWallet(
  route: "ethereum" | "arbitrum" | "base" | "solana" | "stellar",
): Promise<void> {
  if (route === "solana") {
    requireOrInstallPhantom();
    return;
  }
  if (route === "stellar") {
    await requireOrInstallFreighter();
    return;
  }
  requireOrInstallEvmWallet();
}
