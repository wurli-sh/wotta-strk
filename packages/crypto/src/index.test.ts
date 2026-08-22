import assert from "node:assert/strict";
import test from "node:test";
import { decryptEnvelope, encryptEnvelope, generateInboxKeyPair, publicKeyFromSecret } from "./index.ts";

test("X25519 inbox envelopes round trip and reject the wrong key", () => {
  const recipient = generateInboxKeyPair();
  const other = generateInboxKeyPair();
  const envelope = encryptEnvelope({ claimSecret: "0x123", intentId: "test" }, recipient.publicKey);
  assert.equal(publicKeyFromSecret(recipient.secretKey), recipient.publicKey);
  assert.deepEqual(decryptEnvelope(envelope, recipient.secretKey), { claimSecret: "0x123", intentId: "test" });
  assert.throws(() => decryptEnvelope(envelope, other.secretKey), /authentication/);
});
