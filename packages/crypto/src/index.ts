import nacl from "tweetnacl";

export type InboxKeyPair = { publicKey: string; secretKey: string };
export type EncryptedEnvelope = {
  algorithm: "x25519-xsalsa20-poly1305";
  ciphertext: string;
  nonce: string;
  ephemeralPublicKey: string;
};

export function generateInboxKeyPair(): InboxKeyPair {
  const pair = nacl.box.keyPair();
  return { publicKey: encode(pair.publicKey), secretKey: encode(pair.secretKey) };
}

export function publicKeyFromSecret(secretKey: string): string {
  return encode(nacl.box.keyPair.fromSecretKey(decode32(secretKey, "secret key")).publicKey);
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
