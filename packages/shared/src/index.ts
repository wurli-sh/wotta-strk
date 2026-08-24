import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { z } from "zod";
import { DENOMINATIONS, STARKNET_JS_VERSION } from "./constants.ts";

export * from "./claim/hash.ts";
export * from "./codecs/cctp.ts";
export * from "./codecs/hook.ts";
export * from "./constants.ts";
export * from "./fixtures/index.ts";

export const identifierSchema = z.object({ provider: z.enum(["email", "google", "x"]), identifier: z.string().min(1).max(320) });
export const resolveSchema = identifierSchema;
export const walletChallengeSchema = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]+$/) });
export const walletLinkSchema = z.object({ challenge: z.string().min(1).max(16_384), signature: z.array(z.string().min(1)).min(1), inboxPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const privateIdentityBindingSchema = z.object({ identityAddress: z.string().regex(/^0x[0-9a-fA-F]+$/) });
export const intentSchema = z.object({ id: z.string().uuid(), mode: z.enum(["standard", "private"]), deliveryKind: z.enum(["registered", "pending", "direct"]), denomination: z.enum(DENOMINATIONS), routeId: z.string().min(1).max(64), claimHash: z.string().regex(/^0x[0-9a-fA-F]+$/), refundHash: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), publicRefundRecipient: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), expiresAt: z.string().datetime() });
export const quoteSchema = intentSchema.extend({ sourceAccount: z.string().min(1).max(256) });
export const sourceSubmittedSchema = z.object({ txHash: z.string().min(3).max(512) });
export const deliverySchema = z.object({ ciphertext: z.string().min(1).max(262_144), nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/), ephemeralPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), algorithm: z.literal("x25519-xsalsa20-poly1305"), recipient: identifierSchema });
export const idempotencySchema = z.string().uuid();

const feltSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);
const txHashSchema = feltSchema.or(z.literal("PENDING"));
const optionalHashSchema = z.union([feltSchema, z.literal("PENDING"), z.literal("UNDECLARED"), z.literal("UNDEPLOYED"), z.literal("UNVERIFIED"), z.literal("UNKNOWN")]);
const optionalAddressSchema = z.union([feltSchema, z.literal("UNDEPLOYED"), z.literal("UNKNOWN")]);
const optionalBlockSchema = z.union([z.number().int().nonnegative(), z.literal("PENDING"), z.literal("UNKNOWN")]);
const optionalIsoSchema = z.union([z.string().datetime(), z.literal("PENDING"), z.literal("UNKNOWN")]);

export const deploymentActorSchema = z.object({
  address: optionalAddressSchema.default("UNKNOWN"),
  keySource: z.string().min(1).default("env:STARKNET_DEPLOYER_PRIVATE_KEY"),
});

export const deploymentToolingSchema = z.object({
  starknetJs: z.literal(STARKNET_JS_VERSION).default(STARKNET_JS_VERSION),
  walletApiSchema: z.literal("0.10.3").default("0.10.3"),
  scarb: z.string().min(1).default("2.17.0"),
  snforge: z.string().min(1).default("0.59.0"),
});

export const deploymentArtifactSchema = z.object({
  classHash: optionalHashSchema.default("UNDECLARED"),
  address: optionalAddressSchema.default("UNDEPLOYED"),
  declareTxHash: txHashSchema.default("PENDING"),
  deployTxHash: txHashSchema.default("PENDING"),
  deployedBlock: optionalBlockSchema.default("PENDING"),
  constructorCalldata: z.array(z.string()).default([]),
  verification: z.object({
    status: z.enum(["pending", "verified", "skipped", "failed"]).default("pending"),
    checkedAt: optionalIsoSchema.default("PENDING"),
    notes: z.string().min(1).default("Verification not run yet."),
  }).default({ status: "pending", checkedAt: "PENDING", notes: "Verification not run yet." }),
});

export const deploymentPoolSchema = deploymentArtifactSchema.extend({
  key: z.enum(["pool1", "pool10", "pool50", "pool100"]),
  denomination: z.enum(DENOMINATIONS),
});

export const directPrivacyManifestSchema = z.object({
  status: z.enum(["pending", "verified"]),
  source: z.string().min(1),
  poolAddress: feltSchema,
  poolClassHash: feltSchema,
  identityClassHash: feltSchema,
  usdc: feltSchema,
  proverUpstream: z.string().url().startsWith("https://"),
  discoveryUpstream: z.string().url().startsWith("https://"),
  verificationNotes: z.string().min(1).optional(),
  escrow: z.object({
    status: z.literal("verified"),
    address: feltSchema,
    classHash: feltSchema,
    denomination: z.enum(DENOMINATIONS),
    deploymentTxHash: feltSchema,
    deployedBlock: z.number().int().nonnegative(),
    verificationNotes: z.string().min(1),
  }).strict().optional(),
}).strict();

export const walletManagedPrivacyManifestSchema = z.object({
  status: z.enum(["pending", "verified"]),
  source: z.string().min(1),
  poolAddress: feltSchema,
  poolClassHash: feltSchema,
  usdc: feltSchema,
  feeToken: feltSchema,
  actionAmount: z.literal("100000"),
  allowedActionAmounts: z.tuple([
    z.literal("100000"),
    z.literal("1000000"),
    z.literal("10000000"),
    z.literal("50000000"),
    z.literal("100000000"),
  ]),
  protocolFeeStrk: z.string().regex(/^\d+$/),
  walletApiSchema: z.literal("0.10.3"),
  verificationNotes: z.string().min(1),
}).strict();

export const deploymentManifestSchema = z.object({
  version: z.literal(1),
  chainId: z.enum(["SN_MAIN", "SN_SEPOLIA"]),
  network: z.enum(["mainnet", "sepolia"]),
  rpcUrlEnv: z.literal("STARKNET_RPC_URL").default("STARKNET_RPC_URL"),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/).or(z.literal("PENDING")),
  generatedAt: optionalIsoSchema.default("PENDING"),
  verified: z.boolean().default(false),
  verificationNotes: z.string().min(1).default("Phase 1 deployment evidence has not been recorded; all routes are disabled."),
  usdc: feltSchema,
  strk20Pool: feltSchema,
  strk20ClassHash: optionalHashSchema.default("UNKNOWN"),
  directPrivacy: directPrivacyManifestSchema.optional(),
  walletManagedPrivacy: walletManagedPrivacyManifestSchema.optional(),
  deployer: deploymentActorSchema.default({ address: "UNKNOWN", keySource: "env:STARKNET_DEPLOYER_PRIVATE_KEY" }),
  tooling: deploymentToolingSchema.default({
    starknetJs: STARKNET_JS_VERSION,
    walletApiSchema: "0.10.3",
    scarb: "2.17.0",
    snforge: "0.59.0",
  }),
  router: deploymentArtifactSchema,
  pools: z.array(deploymentPoolSchema).length(4),
  evidence: z.object({
    root: z.string().min(1).default("evidence"),
    walletSmokeFlow: z.string().min(1).default("phase1-wallet-api"),
    liveSmokeFlow: z.string().min(1).default("phase1-live-smoke"),
  }).default({
    root: "evidence",
    walletSmokeFlow: "phase1-wallet-api",
    liveSmokeFlow: "phase1-live-smoke",
  }),
}).strict().superRefine((manifest, context) => {
  const expected = manifest.network === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA";
  if (manifest.chainId !== expected) context.addIssue({ code: z.ZodIssueCode.custom, message: "network and chainId must match" });
  if (manifest.walletManagedPrivacy) {
    if (manifest.network !== "mainnet") context.addIssue({ code: z.ZodIssueCode.custom, message: "wallet-managed privacy is mainnet-only" });
    if (BigInt(manifest.walletManagedPrivacy.poolAddress) !== BigInt(manifest.strk20Pool)) context.addIssue({ code: z.ZodIssueCode.custom, message: "wallet-managed pool must match strk20Pool" });
    if (BigInt(manifest.walletManagedPrivacy.poolClassHash) !== BigInt(manifest.strk20ClassHash)) context.addIssue({ code: z.ZodIssueCode.custom, message: "wallet-managed class must match strk20ClassHash" });
    if (BigInt(manifest.walletManagedPrivacy.usdc) !== BigInt(manifest.usdc)) context.addIssue({ code: z.ZodIssueCode.custom, message: "wallet-managed USDC must match manifest USDC" });
  }
});

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

export function hashDeploymentManifest(
  manifest: Omit<DeploymentManifest, "manifestHash">,
): string {
  return z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(manifest)))));
}
