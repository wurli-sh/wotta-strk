import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deploymentManifestSchema, hashDeploymentManifest } from "@wotta/shared";
import { constants, RpcProvider } from "starknet";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"), PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  API_ORIGIN: z.string().url().default("http://127.0.0.1:8787"), CORS_ORIGINS: z.string().min(1).default("http://localhost:3000"), LOG_LEVEL: z.string().default("info"),
  SUPABASE_URL: z.string().url(), SUPABASE_SECRET_KEY: z.string().min(20), STARKNET_RPC_URL: z.string().url(), STARKNET_MAINNET_RPC_URL: z.string().url().optional(), STARKNET_NETWORK: z.enum(["mainnet", "sepolia"]).default("mainnet"),
  RESOLVER_SIGNING_KEY: z.string().min(32), IDENTITY_LOOKUP_KEY: z.string().min(32), PENDING_DELIVERY_PRIVATE_KEY: z.string().min(32),
  CIRCLE_IRIS_BASE_URL: z.string().url().optional(), STARKNET_RELAYER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_RELAYER_KEY_OR_KEYSTORE: z.string().min(1).optional(),
  STARKNET_DEPLOYER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_DEPLOYER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{1,64}$/).optional(),
  DEPLOYMENT_MANIFEST_PATH: z.string().optional(),
  CCTP_ADMITTED_ROUTES: z.string().default(""),
}).passthrough();
export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsedEnv = envSchema.parse(source);
  const env = { ...parsedEnv, CIRCLE_IRIS_BASE_URL: parsedEnv.CIRCLE_IRIS_BASE_URL ?? (parsedEnv.STARKNET_NETWORK === "sepolia" ? "https://iris-api-sandbox.circle.com" : "https://iris-api.circle.com") };
  if (Buffer.from(env.PENDING_DELIVERY_PRIVATE_KEY, "base64url").length !== 32) throw new Error("invalid_pending_delivery_key");
  const manifestPath = env.DEPLOYMENT_MANIFEST_PATH ?? fileURLToPath(new URL(`../../../deployments/${env.STARKNET_NETWORK}.json`, import.meta.url));
  let manifest: ReturnType<typeof deploymentManifestSchema.parse>;
  try { manifest = deploymentManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8"))); } catch { throw new Error("invalid_deployment_manifest"); }
  const expectedChainId = env.STARKNET_NETWORK === "mainnet" ? "SN_MAIN" : "SN_SEPOLIA";
  if (manifest.chainId !== expectedChainId || !/^0x[0-9a-f]+$/i.test(manifest.usdc) || !/^0x[0-9a-f]+$/i.test(manifest.strk20Pool)) throw new Error("network_manifest_mismatch");
  const { manifestHash: declaredManifestHash, ...unsignedManifest } = manifest;
  const manifestHash = hashDeploymentManifest(unsignedManifest);
  if (declaredManifestHash !== manifestHash) throw new Error("deployment_manifest_hash_mismatch");
  const admittedCctpRoutes = new Set(
    env.CCTP_ADMITTED_ROUTES.split(",").map((route) => route.trim()).filter(Boolean),
  );
  const supportedCctpRoutes = new Set(["ethereum", "arbitrum", "base", "solana", "stellar"]);
  for (const route of admittedCctpRoutes) {
    if (!supportedCctpRoutes.has(route)) throw new Error(`unsupported_admitted_route:${route}`);
  }
  return { env, port: env.PORT, origin: env.API_ORIGIN.replace(/\/$/, ""), corsOrigins: env.CORS_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean), manifestHash, manifest, manifestPath, admittedCctpRoutes };
}

export async function assertStarknetRpcNetwork(config: Config): Promise<void> {
  let chainId: string;
  try { chainId = await new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL }).getChainId(); } catch { throw new Error("starknet_rpc_unavailable"); }
  const expected = config.manifest.chainId === "SN_MAIN" ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
  if (chainId !== expected) throw new Error("network_manifest_mismatch");
}
