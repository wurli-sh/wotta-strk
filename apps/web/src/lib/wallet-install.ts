const METAMASK_INSTALL = "https://metamask.io/download/";

export function hasInjectedEvmWallet(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as typeof window & { ethereum?: unknown }).ethereum,
  );
}

/** Toast-friendly message when wallet extension is missing; also opens install page. */
export function requireOrInstallEvmWallet(): void {
  if (hasInjectedEvmWallet()) return;
  if (typeof window !== "undefined") {
    window.open(METAMASK_INSTALL, "_blank", "noopener,noreferrer");
  }
  throw new Error("Install or unlock an EVM wallet");
}

export function openEvmWalletInstall() {
  if (typeof window !== "undefined") {
    window.open(METAMASK_INSTALL, "_blank", "noopener,noreferrer");
  }
}
