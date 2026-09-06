import { decryptEnvelope } from "@wotta/crypto";

export type EncryptedInboxNote = {
  id: string;
  ciphertext: string;
  nonce: string;
  sender_public_key: string;
  algorithm: "x25519-xsalsa20-poly1305";
};

/** True when this device's inbox secret can open the note ciphertext. */
export function canDecryptInboxNote(
  note: EncryptedInboxNote,
  inboxSecretKey: string | string[] | undefined,
): boolean {
  const secrets = Array.isArray(inboxSecretKey)
    ? inboxSecretKey
    : inboxSecretKey
      ? [inboxSecretKey]
      : [];
  for (const secret of secrets) {
    try {
      decryptEnvelope({
        algorithm: note.algorithm,
        ciphertext: note.ciphertext,
        nonce: note.nonce,
        ephemeralPublicKey: note.sender_public_key,
      }, secret);
      return true;
    } catch {
      // Try the next locally retained key.
    }
  }
  return false;
}

export function isWrongInboxKeyError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /encrypted to a different inbox key|can’t decrypt your inbox|can't decrypt your inbox/i.test(message);
}

export function isMissingInboxKeyError(message: string | null | undefined): boolean {
  if (!message) return false;
  if (isWrongInboxKeyError(message)) return false;
  return /no wotta inbox key|missing the inbox key/i.test(message);
}
