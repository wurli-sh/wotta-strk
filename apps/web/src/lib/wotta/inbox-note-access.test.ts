import { describe, expect, it } from "vitest";
import { encryptEnvelope, generateInboxKeyPair } from "@wotta/crypto";
import {
  canDecryptInboxNote,
  isMissingInboxKeyError,
  isWrongInboxKeyError,
} from "./inbox-note-access";

describe("inbox note access", () => {
  it("detects when the local secret can open a note", () => {
    const owner = generateInboxKeyPair();
    const other = generateInboxKeyPair();
    const envelope = encryptEnvelope({ hello: true }, owner.publicKey);
    const note = {
      id: "n1",
      ciphertext: envelope.ciphertext,
      nonce: envelope.nonce,
      sender_public_key: envelope.ephemeralPublicKey,
      algorithm: "x25519-xsalsa20-poly1305" as const,
    };
    expect(canDecryptInboxNote(note, owner.secretKey)).toBe(true);
    expect(canDecryptInboxNote(note, other.secretKey)).toBe(false);
    expect(canDecryptInboxNote(note, undefined)).toBe(false);
  });

  it("classifies claim errors without treating wrong-key as missing-key", () => {
    expect(isWrongInboxKeyError("This payment was encrypted to a different inbox key.")).toBe(true);
    expect(isMissingInboxKeyError("This payment was encrypted to a different inbox key.")).toBe(false);
    expect(isMissingInboxKeyError("This browser has no Wotta inbox key")).toBe(true);
  });
});
