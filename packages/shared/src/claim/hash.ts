import { hash } from "starknet";
import { SN_MAIN, SN_MAIN_FELT } from "../constants.ts";
import {
  normalizeFelt,
  shortStringToFelt,
  toCanonicalHex,
  type FeltLike,
} from "../internal/felt.ts";

export const WOTTA_CLAIM_V1 = "WOTTA_CLAIM_V1" as const;
export const WOTTA_REFUND_V1 = "WOTTA_REFUND_V1" as const;

export type SecretScopedHashInput = {
  chainId?: FeltLike;
  poolAddress: FeltLike;
  secret: FeltLike;
};

export function computeClaimHash(input: SecretScopedHashInput): string {
  return computeTaggedSecretHash(WOTTA_CLAIM_V1, input);
}

export function computeRefundHash(input: SecretScopedHashInput): string {
  return computeTaggedSecretHash(WOTTA_REFUND_V1, input);
}

export function computeTaggedSecretHash(
  tag: typeof WOTTA_CLAIM_V1 | typeof WOTTA_REFUND_V1,
  { chainId = SN_MAIN, poolAddress, secret }: SecretScopedHashInput,
): string {
  const elements = [
    shortStringToFelt(tag),
    normalizeChainId(chainId),
    normalizeFelt(poolAddress),
    normalizeNonZeroSecret(secret),
  ];

  return toCanonicalHex(hash.computePoseidonHashOnElements(elements));
}

function normalizeChainId(value: FeltLike): bigint {
  if (value === SN_MAIN) {
    return normalizeFelt(SN_MAIN_FELT);
  }

  return typeof value === "string" && !value.startsWith("0x") && !/^[0-9]+$/.test(value)
    ? shortStringToFelt(value)
    : normalizeFelt(value);
}

function normalizeNonZeroSecret(value: FeltLike): bigint {
  const normalized = normalizeFelt(value);
  if (normalized === 0n) {
    throw new RangeError("secret must be non-zero");
  }

  return normalized;
}
