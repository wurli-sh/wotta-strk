import { stark, type TypedData, type WalletAccountV6 } from "starknet";
import type { DirectPrivacyConfig } from "./privacy-config.ts";

export type PrivacyState = {
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

  async setIdentityAddress(identityAddress: string): Promise<void> {
    this.state.identityAddress = identityAddress;
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
  config: DirectPrivacyConfig,
): Promise<PrivacyVault> {
  const typedData = unlockTypedData(account.address, config.poolAddress);
  const signature = stark.formatSignature(await account.signMessage(typedData));
  persistUnlockSession(account.address, config.poolAddress, signature);
  return vaultFromSignature(account.address, config.poolAddress, signature);
}

/** Restore an inbox unlock from this browser tab without re-signing Ready. */
export async function restorePrivacyVaultFromSession(
  wallet: string,
  config: DirectPrivacyConfig,
): Promise<PrivacyVault | null> {
  const signature = readUnlockSession(wallet, config.poolAddress);
  if (!signature) return null;
  const storageKey = stateStorageKey(wallet, config.poolAddress);
  if (!localStorage.getItem(storageKey)) return null;
  try {
    return await vaultFromSignature(wallet, config.poolAddress, signature);
  } catch {
    clearUnlockSession(wallet, config.poolAddress);
    return null;
  }
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
  const state = stored ? await decryptState(stored, key) : {
    version: 1 as const,
    viewingKey: `0x${generateViewingKey().toString(16)}`,
  };
  const vault = new PrivacyVault(storageKey, key, state);
  if (!stored) await vault.save();
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

function unlockTypedData(wallet: string, pool: string): TypedData {
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
    domain: { name: "Wotta", version: "1", chainId: "SN_SEPOLIA", revision: "1" },
    message: { wallet, pool, purpose: "privacy-state" },
  };
}

async function decryptState(raw: string, key: CryptoKey): Promise<PrivacyState> {
  try {
    const record = JSON.parse(raw) as EncryptedState;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv) },
      key,
      fromBase64(record.ciphertext),
    );
    const state = JSON.parse(new TextDecoder().decode(plaintext)) as PrivacyState;
    if (state.version !== 1 || !/^0x[0-9a-f]+$/i.test(state.viewingKey)) {
      throw new Error("invalid state payload");
    }
    return state;
  } catch {
    throw new Error(
      "Could not unlock the encrypted privacy state. Use the same Ready account and do not clear its signing identity.",
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
