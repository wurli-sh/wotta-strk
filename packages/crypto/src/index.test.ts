import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeInboxSignature,
  decryptEnvelope,
  deriveInboxKeyPairFromSeed,
  deriveInboxKeyPairFromSignature,
  encryptEnvelope,
  generateInboxKeyPair,
  inboxKeySeedFromCanonicalSignature,
  inboxKeyTypedData,
  publicKeyFromSecret,
} from "./index.ts";

test("X25519 inbox envelopes round trip and reject the wrong key", () => {
  const recipient = generateInboxKeyPair();
  const other = generateInboxKeyPair();
  const envelope = encryptEnvelope({ claimSecret: "0x123", intentId: "test" }, recipient.publicKey);
  assert.equal(publicKeyFromSecret(recipient.secretKey), recipient.publicKey);
  assert.deepEqual(decryptEnvelope(envelope, recipient.secretKey), { claimSecret: "0x123", intentId: "test" });
  assert.throws(() => decryptEnvelope(envelope, other.secretKey), /authentication/);
});

test("deriveInboxKeyPairFromSeed is stable and rejects wrong length", () => {
  const seed = new Uint8Array(32).fill(7);
  const a = deriveInboxKeyPairFromSeed(seed);
  const b = deriveInboxKeyPairFromSeed(seed);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(a.secretKey, b.secretKey);
  assert.equal(publicKeyFromSecret(a.secretKey), a.publicKey);
  assert.throws(() => deriveInboxKeyPairFromSeed(new Uint8Array(16)), /32 bytes/);
});

test("signature derivation is golden-stable and chain-separated", () => {
  const parts = ["0x0abc", "0xDEF"];
  assert.equal(canonicalizeInboxSignature(parts), "0xabc:0xdef");
  assert.equal(
    canonicalizeInboxSignature(["0x0ABC", "0x00def"]),
    canonicalizeInboxSignature(["0xabc", "0xdef"]),
  );

  const wallet = "0x0123";
  const main = deriveInboxKeyPairFromSignature(parts, "SN_MAIN", wallet);
  const mainAgain = deriveInboxKeyPairFromSignature(
    ["0xABC", "0xdef"],
    "SN_MAIN",
    "0x123",
  );
  const sepolia = deriveInboxKeyPairFromSignature(parts, "SN_SEPOLIA", wallet);

  assert.equal(main.publicKey, mainAgain.publicKey);
  assert.notEqual(main.publicKey, sepolia.publicKey);

  const seed = inboxKeySeedFromCanonicalSignature(
    canonicalizeInboxSignature(parts),
    "SN_MAIN",
    wallet,
  );
  assert.equal(deriveInboxKeyPairFromSeed(seed).publicKey, main.publicKey);

  const envelope = encryptEnvelope({ ok: true }, main.publicKey);
  assert.deepEqual(decryptEnvelope(envelope, main.secretKey), { ok: true });
  assert.throws(() => decryptEnvelope(envelope, sepolia.secretKey), /authentication/);
});

test("inboxKeyTypedData pins purpose and omits pool", () => {
  const typed = inboxKeyTypedData("0xabc", "SN_MAIN");
  assert.equal(typed.primaryType, "InboxKey");
  assert.equal(typed.message.purpose, "inbox-key-v1");
  assert.equal(typed.domain.chainId, "SN_MAIN");
  assert.equal("pool" in typed.message, false);
});
