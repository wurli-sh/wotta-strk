import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";

export type InboxKeyPair = { publicKey: string; secretKey: string };
export type EncryptedEnvelope = {
  algorithm: "x25519-xsalsa20-poly1305";
  ciphertext: string;
  nonce: string;
  ephemeralPublicKey: string;
};

export type InboxKeyChainId = "SN_MAIN" | "SN_SEPOLIA";

/** SNIP-12 TypedData for Ready-derived inbox keys (no pool — binding-scoped). */
export function inboxKeyTypedData(
  wallet: string,
  chainId: InboxKeyChainId,
): {
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  domain: { name: string; version: string; chainId: string; revision: string };
  message: { wallet: string; purpose: string };
} {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      InboxKey: [
        { name: "wallet", type: "felt" },
        { name: "purpose", type: "shortstring" },
      ],
    },
    primaryType: "InboxKey",
    domain: { name: "Wotta", version: "1", chainId, revision: "1" },
    message: { wallet, purpose: "inbox-key-v1" },
  };
}

export function generateInboxKeyPair(): InboxKeyPair {
  const pair = nacl.box.keyPair();
  return { publicKey: encode(pair.publicKey), secretKey: encode(pair.secretKey) };
}

/** Normalize formatSignature felts for stable HKDF input. */
export function canonicalizeInboxSignature(parts: readonly string[]): string {
  return parts.map(normalizeFeltHex).join(":");
}

export function inboxKeySeedFromCanonicalSignature(
  canonicalSignature: string,
  chainId: InboxKeyChainId,
  wallet: string,
): Uint8Array {
  const ikm = new TextEncoder().encode(canonicalSignature);
  const salt = new TextEncoder().encode("wotta");
  const info = new TextEncoder().encode(
    `wotta-inbox-key-v1|${chainId}|${normalizeWalletHex(wallet)}`,
  );
  return hkdf(sha256, ikm, salt, info, 32);
}

export function deriveInboxKeyPairFromSeed(seed: Uint8Array): InboxKeyPair {
  if (seed.length !== nacl.box.secretKeyLength) {
    throw new RangeError("inbox seed must be 32 bytes");
  }
  const pair = nacl.box.keyPair.fromSecretKey(seed);
  return { publicKey: encode(pair.publicKey), secretKey: encode(pair.secretKey) };
}

export function deriveInboxKeyPairFromSignature(
  signatureParts: readonly string[],
  chainId: InboxKeyChainId,
  wallet: string,
): InboxKeyPair {
  const seed = inboxKeySeedFromCanonicalSignature(
    canonicalizeInboxSignature(signatureParts),
    chainId,
    wallet,
  );
  return deriveInboxKeyPairFromSeed(seed);
}

export function publicKeyFromSecret(secretKey: string): string {
  return encode(nacl.box.keyPair.fromSecretKey(decode32(secretKey, "secret key")).publicKey);
}

function normalizeFeltHex(value: string): string {
  const raw = value.trim();
  const hex = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new RangeError("signature felt must be hex");
  }
  return `0x${BigInt(`0x${hex || "0"}`).toString(16)}`;
}

function normalizeWalletHex(wallet: string): string {
  return `0x${BigInt(wallet).toString(16)}`;
}

export function encryptEnvelope(
  value: unknown,
  recipientPublicKey: string,
  senderSecretKey?: string,
): EncryptedEnvelope {
  const sender = senderSecretKey
    ? nacl.box.keyPair.fromSecretKey(decode32(senderSecretKey, "sender secret key"))
    : nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = nacl.box(plaintext, nonce, decode32(recipientPublicKey, "recipient public key"), sender.secretKey);
  return {
    algorithm: "x25519-xsalsa20-poly1305",
    ciphertext: encode(ciphertext),
    nonce: encode(nonce),
    ephemeralPublicKey: encode(sender.publicKey),
  };
}

export function decryptEnvelope<T>(
  envelope: EncryptedEnvelope,
  recipientSecretKey: string,
): T {
  if (envelope.algorithm !== "x25519-xsalsa20-poly1305") throw new Error("unsupported envelope algorithm");
  const plaintext = nacl.box.open(
    decode(envelope.ciphertext),
    decodeNonce(envelope.nonce),
    decode32(envelope.ephemeralPublicKey, "sender public key"),
    decode32(recipientSecretKey, "recipient secret key"),
  );
  if (!plaintext) throw new Error("envelope authentication failed");
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

function encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decode32(value: string, label: string): Uint8Array {
  const bytes = decode(value);
  if (bytes.length !== nacl.box.publicKeyLength) throw new RangeError(`${label} must be 32 bytes`);
  return bytes;
}

function decodeNonce(value: string): Uint8Array {
  const bytes = decode(value);
  if (bytes.length !== nacl.box.nonceLength) throw new RangeError("nonce must be 24 bytes");
  return bytes;
}
