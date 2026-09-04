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
  inboxSecretKey: string | undefined,
): boolean {
  if (!inboxSecretKey) return false;
  try {
    decryptEnvelope({
      algorithm: note.algorithm,
      ciphertext: note.ciphertext,
      nonce: note.nonce,
      ephemeralPublicKey: note.sender_public_key,
    }, inboxSecretKey);
    return true;
  } catch {
    return false;
  }
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
