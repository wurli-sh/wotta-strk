import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Felt } from "./types.ts";

export type SmokeManifest = {
  version: number;
  chainId: "SN_MAIN" | "SN_SEPOLIA";
  usdc: string;
  strk20Pool: string;
  strk20ClassHash?: string;
  verified?: boolean;
  reason?: string;
  directPrivacy?: DirectPrivacyManifest;
};

export type DirectPrivacyManifest = {
  status: "verified" | "pending";
  source: string;
  poolAddress: string;
  poolClassHash: string;
  identityClassHash: string;
  usdc: string;
  proverUpstream: string;
  discoveryUpstream: string;
  verificationNotes?: string;
  escrow?: DirectPrivacyEscrowManifest;
};

export type DirectPrivacyEscrowManifest = {
  status: "verified";
  address: string;
  classHash: string;
  denomination: "100000" | "1000000" | "10000000" | "50000000" | "100000000";
  deploymentTxHash: string;
  deployedBlock: number;
  verificationNotes: string;
};

export const CIRCLE_SEPOLIA_USDC =
  "0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343";

export type SmokeEnv = Record<string, string | undefined>;

export type SmokeConfig = {
  rpcUrl: string;
  chainId: SmokeManifest["chainId"];
  usdc: string;
  readyUsdc: string;
  strk20Pool: string;
  strk20ClassHash?: string;
  helperAddress?: string;
  transferRecipient?: string;
  smokeAmount: string;
  manifestHash: string;
  walletApiSchema: "0.10.3";
  starknetJs: "10.5.0";
  directPrivacy?: DirectPrivacyConfig;
  productApi?: {
    apiUrl: string;
    supabaseUrl: string;
    supabasePublishableKey: string;
    solanaRpcUrl: string;
    stellarRpcUrl: string;
  };
};

export type DirectPrivacyConfig = {
  chainId: "SN_MAIN" | "SN_SEPOLIA";
  poolAddress: string;
  poolClassHash: string;
  identityClassHash: string;
  usdc: string;
  proverPath: "/privacy/prover";
  discoveryPath: "/privacy/discovery";
  source: string;
  escrow?: DirectPrivacyEscrowConfig;
};

export type DirectPrivacyEscrowConfig = {
  address: string;
  classHash: string;
  denomination: bigint;
};

const FELT_RE = /^0x[0-9a-fA-F]+$/;

export function hashManifest(manifest: SmokeManifest): string {
  return bytesToHex(sha256(JSON.stringify(manifest)));
}

export function loadSmokeConfig(
  env: SmokeEnv,
  manifest: SmokeManifest,
): SmokeConfig {
  const rpcUrl =
    env.VITE_STARKNET_RPC_URL?.trim() || env.STARKNET_RPC_URL?.trim();
  if (!rpcUrl) {
    throw new Error(
      "missing STARKNET_RPC_URL or VITE_STARKNET_RPC_URL for wallet-smoke",
    );
  }
  if (!FELT_RE.test(manifest.usdc) || !FELT_RE.test(manifest.strk20Pool)) {
    throw new Error("manifest USDC or STRK20 pool address is invalid");
  }

  const helperAddress = optionalFelt(env.VITE_HELPER_ADDRESS);
  const transferRecipient = optionalFelt(env.VITE_TRANSFER_RECIPIENT);
  const readyUsdc = optionalFelt(env.VITE_READY_USDC_ADDRESS) ??
    (manifest.chainId === "SN_SEPOLIA" ? CIRCLE_SEPOLIA_USDC : manifest.usdc);
  const smokeAmount =
    env.VITE_SMOKE_AMOUNT?.trim() || env.SMOKE_AMOUNT?.trim() || "1000000";
  if (!/^\d+$/.test(smokeAmount) || smokeAmount === "0") {
    throw new Error("VITE_SMOKE_AMOUNT must be a positive decimal integer");
  }

  const config: SmokeConfig = {
    rpcUrl,
    chainId: manifest.chainId,
    usdc: manifest.usdc,
    readyUsdc,
    strk20Pool: manifest.strk20Pool,
    smokeAmount,
    manifestHash: hashManifest(manifest),
    walletApiSchema: "0.10.3",
    starknetJs: "10.5.0",
  };
  if (manifest.strk20ClassHash) {
    config.strk20ClassHash = manifest.strk20ClassHash;
  }
  if (manifest.directPrivacy) {
    config.directPrivacy = {
      ...loadDirectPrivacyConfig(manifest.directPrivacy),
      chainId: manifest.chainId,
    };
  }
  if (helperAddress) config.helperAddress = helperAddress;
  if (transferRecipient) config.transferRecipient = transferRecipient;
  const apiUrl = env.VITE_WOTTA_API_URL?.trim();
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (apiUrl && supabaseUrl && supabasePublishableKey) {
    config.productApi = {
      apiUrl: apiUrl.replace(/\/$/, ""),
      supabaseUrl,
      supabasePublishableKey,
      solanaRpcUrl: env.VITE_SOLANA_DEVNET_RPC_URL?.trim() || "https://api.devnet.solana.com",
      stellarRpcUrl: env.VITE_STELLAR_TESTNET_RPC_URL?.trim() || "https://soroban-testnet.stellar.org",
    };
  }
  return config;
}

export function requireDirectPrivacy(config: SmokeConfig): DirectPrivacyConfig {
  if (config.chainId !== "SN_SEPOLIA" || !config.directPrivacy) {
    throw new Error("direct Privacy SDK route is configured only for Sepolia");
  }
  return config.directPrivacy;
}

function loadDirectPrivacyConfig(
  manifest: DirectPrivacyManifest,
): DirectPrivacyConfig {
  const felts = [
    manifest.poolAddress,
    manifest.poolClassHash,
    manifest.identityClassHash,
    manifest.usdc,
  ];
  if (manifest.status !== "verified" || felts.some((value) => !FELT_RE.test(value))) {
    throw new Error("direct privacy manifest is not verified or contains invalid felts");
  }
  if (!manifest.proverUpstream.startsWith("https://") ||
      !manifest.discoveryUpstream.startsWith("https://")) {
    throw new Error("direct privacy upstreams must use HTTPS");
  }
  const config: DirectPrivacyConfig = {
    // This is filled by loadSmokeConfig from the enclosing deployment manifest.
    chainId: "SN_SEPOLIA",
    poolAddress: manifest.poolAddress,
    poolClassHash: manifest.poolClassHash,
    identityClassHash: manifest.identityClassHash,
    usdc: manifest.usdc,
    proverPath: "/privacy/prover",
    discoveryPath: "/privacy/discovery",
    source: manifest.source,
  };
  if (manifest.escrow) {
    const escrow = manifest.escrow;
    if (!FELT_RE.test(escrow.address) || !FELT_RE.test(escrow.classHash) ||
        !FELT_RE.test(escrow.deploymentTxHash) || !/^\d+$/.test(escrow.denomination)) {
      throw new Error("direct privacy escrow manifest contains invalid values");
    }
    config.escrow = {
      address: escrow.address,
      classHash: escrow.classHash,
      denomination: BigInt(escrow.denomination),
    };
  }
  return config;
}

export function assertHelperConfigured(config: SmokeConfig): string {
  if (!config.helperAddress) {
    throw new Error(
      "helper address required: set VITE_HELPER_ADDRESS for private fund/claim flows",
    );
  }
  return config.helperAddress;
}

function optionalFelt(value: string | undefined): Felt | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!FELT_RE.test(trimmed)) {
    throw new Error(`invalid felt address: ${trimmed}`);
  }
  return trimmed;
}
