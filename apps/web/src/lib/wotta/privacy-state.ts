import { ec, stark, type TypedData, type WalletAccountV6 } from "starknet";
import type { DirectPrivacyConfig } from "./privacy-config.ts";
import { ensureReadyChain } from "./ready.ts";

export type PrivacyState = {
  version: 2;
  viewingKey: string;
  identityClassHash?: string;
  identityAddress?: string;
  /** Block where the privacy identity was deployed; needed to prove registration safely. */
  identityDeployedBlock?: number;
  inboxSecretKey?: string;
};

const MAX_VIEWING_KEY = ec.starkCurve.CURVE.n / 2n;

function isValidViewingKey(viewingKey: string): boolean {
  if (!/^0x[0-9a-f]+$/i.test(viewingKey)) return false;
  try {
    const value = BigInt(viewingKey);
    return value > 0n && value <= MAX_VIEWING_KEY;
  } catch {
    return false;
  }
}

export function materializePrivacyState(
  rawState: PrivacyState | LegacyPrivacyState | null,
): PrivacyState {
  if (rawState?.version === 2 && isValidViewingKey(rawState.viewingKey)) return rawState;
  if (rawState?.version === 1 && isValidViewingKey(rawState.viewingKey)) {
    return {
      version: 2,
      viewingKey: rawState.viewingKey,
      identityAddress: rawState.identityAddress,
      inboxSecretKey: rawState.inboxSecretKey,
    };
  }
  return {
    version: 2,
    viewingKey: `0x${generateViewingKey().toString(16)}`,
  };
}

type PrivacyVaultUnlockConfig = {
  chainId: "SN_MAIN" | "SN_SEPOLIA";
  poolAddress: string;
};

type LegacyPrivacyState = {
  version: 1;
  viewingKey: string;
  identityAddress?: string;
  inboxSecretKey?: string;
};

type EncryptedState = {
  version: 1;
  iv: string;
  ciphertext: string;
};

export class PrivacyVault {
  private readonly storageKey: string;
  private readonly encryptionKey: CryptoKey;
  public readonly state: PrivacyState;

  constructor(
    storageKey: string,
    encryptionKey: CryptoKey,
    state: PrivacyState,
  ) {
    this.storageKey = storageKey;
    this.encryptionKey = encryptionKey;
    this.state = state;
  }

  async setIdentityAddress(
    identityAddress: string,
    identityClassHash: string,
    identityDeployedBlock?: number,
  ): Promise<void> {
    this.state.identityAddress = identityAddress;
    this.state.identityClassHash = identityClassHash;
    if (identityDeployedBlock !== undefined) {
      this.state.identityDeployedBlock = identityDeployedBlock;
    }
    await this.save();
  }

  async setInboxSecretKey(inboxSecretKey: string): Promise<void> {
    this.state.inboxSecretKey = inboxSecretKey;
    await this.save();
  }

  async save(): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(this.state));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.encryptionKey,
      plaintext,
    );
    const record: EncryptedState = {
      version: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(record));
  }
}

export async function unlockPrivacyVault(
  account: WalletAccountV6,
  config: PrivacyVaultUnlockConfig,
): Promise<PrivacyVault> {
  const mode = config.chainId === "SN_MAIN" ? "mainnet" : "testnet";
  await ensureReadyChain(account, mode);
  const typedData = unlockTypedData(account.address, config.poolAddress, config.chainId);
  const signature = stark.formatSignature(await account.signMessage(typedData));
  persistUnlockSession(account.address, config.poolAddress, signature);
  return vaultFromSignature(account.address, config.poolAddress, signature);
}

/** Restore an inbox unlock from this browser tab without re-signing Ready. */
export async function restorePrivacyVaultFromSession(
  wallet: string,
  config: PrivacyVaultUnlockConfig & { identityClassHash?: string },
): Promise<PrivacyVault | null> {
  const signature = readUnlockSession(wallet, config.poolAddress);
  if (!signature) return null;
  const storageKey = stateStorageKey(wallet, config.poolAddress);
  if (!localStorage.getItem(storageKey)) return null;
  try {
    const vault = await vaultFromSignature(wallet, config.poolAddress, signature);
    if (
      config.identityClassHash
      && isStalePrivacyState(vault.state, { identityClassHash: config.identityClassHash })
    ) {
      clearPrivacyVaultLocalState(wallet, config.poolAddress);
      return null;
    }
    return vault;
  } catch {
    clearPrivacyVaultLocalState(wallet, config.poolAddress);
    return null;
  }
}

export function clearPrivacyVaultLocalState(wallet: string, pool: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(stateStorageKey(wallet, pool));
  clearUnlockSession(wallet, pool);
}

export function clearAllPrivacyVaultLocalState(): void {
  if (typeof window === "undefined") return;
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("wotta:privacy:v")) localStorage.removeItem(key);
  }
  clearAllUnlockSessions();
}

export function isStalePrivacyState(
  state: PrivacyState | LegacyPrivacyState,
  config: { identityClassHash: string },
): boolean {
  if (state.version !== 2) return true;
  if (!state.identityAddress) return false;
  return state.identityClassHash !== config.identityClassHash;
}

export async function ensureCurrentIdentityClass(
  account: WalletAccountV6,
  vault: PrivacyVault,
  config: DirectPrivacyConfig,
): Promise<boolean> {
  if (!isStalePrivacyState(vault.state, config)) {
    if (!vault.state.identityAddress) return false;
    try {
      const onChain = await account.provider.getClassHashAt(vault.state.identityAddress);
      if (BigInt(onChain) === BigInt(config.identityClassHash)) return false;
    } catch {
      // Fall through to reset when the contract is missing or unreadable.
    }
  }
  vault.state.identityAddress = undefined;
  vault.state.identityClassHash = undefined;
  vault.state.identityDeployedBlock = undefined;
  await vault.save();
  return true;
}

export function clearAllUnlockSessions(): void {
  if (typeof window === "undefined") return;
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(UNLOCK_SESSION_PREFIX)) sessionStorage.removeItem(key);
  }
}

export function clearUnlockSession(wallet: string, pool: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(unlockSessionKey(wallet, pool));
}

async function vaultFromSignature(
  wallet: string,
  pool: string,
  signature: string[],
): Promise<PrivacyVault> {
  const material = new TextEncoder().encode(signature.join(":"));
  const digest = await crypto.subtle.digest("SHA-256", material);
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  const storageKey = stateStorageKey(wallet, pool);
  const stored = localStorage.getItem(storageKey);
  const rawState = stored ? await decryptState(stored, key) : null;
  const state = materializePrivacyState(rawState);
  const vault = new PrivacyVault(storageKey, key, state);
  if (!stored || rawState?.version === 1) await vault.save();
  return vault;
}

const UNLOCK_SESSION_PREFIX = "wotta:privacy-unlock-session:v1:";

function persistUnlockSession(wallet: string, pool: string, signature: string[]): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(unlockSessionKey(wallet, pool), JSON.stringify(signature));
}

function readUnlockSession(wallet: string, pool: string): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(unlockSessionKey(wallet, pool));
    if (!raw) return null;
    const signature = JSON.parse(raw) as string[];
    return Array.isArray(signature) && signature.length > 0 ? signature : null;
  } catch {
    return null;
  }
}

function unlockSessionKey(wallet: string, pool: string): string {
  return `${UNLOCK_SESSION_PREFIX}${BigInt(wallet).toString(16)}:${BigInt(pool).toString(16)}`;
}

export function generateViewingKey(): bigint {
  let value = 0n;
  while (value === 0n) {
    const bytes = crypto.getRandomValues(new Uint8Array(25));
    value = BigInt(`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  }
  return value;
}

function unlockTypedData(
  wallet: string,
  pool: string,
  chainId: PrivacyVaultUnlockConfig["chainId"],
): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Unlock: [
        { name: "wallet", type: "felt" },
        { name: "pool", type: "felt" },
        { name: "purpose", type: "shortstring" },
      ],
    },
    primaryType: "Unlock",
    domain: { name: "Wotta", version: "1", chainId, revision: "1" },
    message: { wallet, pool, purpose: "privacy-state" },
  };
}

async function decryptState(raw: string, key: CryptoKey): Promise<PrivacyState | LegacyPrivacyState> {
  try {
    const record = JSON.parse(raw) as EncryptedState;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv) },
      key,
      fromBase64(record.ciphertext),
    );
    const state = JSON.parse(new TextDecoder().decode(plaintext)) as PrivacyState | LegacyPrivacyState;
    if ((state.version !== 1 && state.version !== 2) || !isValidViewingKey(state.viewingKey)) {
      throw new Error("invalid state payload");
    }
    return state;
  } catch {
    throw new Error(
      "Could not unlock the encrypted private state. Use the same Ready account and do not clear its signing identity.",
    );
  }
}

function stateStorageKey(wallet: string, pool: string): string {
  return `wotta:privacy:v1:${BigInt(wallet).toString(16)}:${BigInt(pool).toString(16)}`;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
