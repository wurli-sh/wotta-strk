import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINNET_ESCROW_POOL_ADDRESS,
  PROTOCOL_FIXTURES,
  SN_MAIN,
  WOTTA_CLAIM_V1,
  WOTTA_REFUND_V1,
  computeClaimHash,
  computeRefundHash,
  computeTaggedSecretHash,
} from "../src/index.ts";

test("claim and refund hashes match golden fixtures", () => {
  assert.equal(
    computeClaimHash({
      chainId: PROTOCOL_FIXTURES.claim.chainId,
      poolAddress: PROTOCOL_FIXTURES.claim.poolAddress,
      secret: PROTOCOL_FIXTURES.claim.claimSecret,
    }),
    PROTOCOL_FIXTURES.claim.claimHash,
  );

  assert.equal(
    computeRefundHash({
      chainId: PROTOCOL_FIXTURES.claim.chainId,
      poolAddress: PROTOCOL_FIXTURES.claim.poolAddress,
      secret: PROTOCOL_FIXTURES.claim.refundSecret,
    }),
    PROTOCOL_FIXTURES.claim.refundHash,
  );
});

test("claim and refund tags are domain-separated", () => {
  const secret = PROTOCOL_FIXTURES.claim.claimSecret;
  const claimHash = computeTaggedSecretHash(WOTTA_CLAIM_V1, {
    chainId: SN_MAIN,
    poolAddress: MAINNET_ESCROW_POOL_ADDRESS,
    secret,
  });
  const refundHash = computeTaggedSecretHash(WOTTA_REFUND_V1, {
    chainId: SN_MAIN,
    poolAddress: MAINNET_ESCROW_POOL_ADDRESS,
    secret,
  });

  assert.notEqual(claimHash, refundHash);
});

test("hash helpers reject zero secrets", () => {
  assert.throws(
    () =>
      computeClaimHash({
        chainId: SN_MAIN,
        poolAddress: MAINNET_ESCROW_POOL_ADDRESS,
        secret: "0x0",
      }),
    /secret must be non-zero/,
  );
});
