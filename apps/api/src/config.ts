import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deploymentManifestSchema, hashDeploymentManifest } from "@wotta/shared";
import { constants, RpcProvider } from "starknet";

const envBoolean = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toLowerCase() : value,
  z.union([z.literal("true"), z.literal("false"), z.boolean()])
    .transform((value) => value === true || value === "true"),
);

/** Treat blank / whitespace optional env URLs as unset. */
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"), PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  API_ORIGIN: z.string().url().default("http://127.0.0.1:8787"), CORS_ORIGINS: z.string().min(1).default("http://localhost:3000"), LOG_LEVEL: z.string().default("info"),
  SUPABASE_URL: z.string().url(), SUPABASE_SECRET_KEY: z.string().min(20), STARKNET_RPC_URL: z.string().url(), STARKNET_MAINNET_RPC_URL: optionalUrl, STARKNET_NETWORK: z.enum(["mainnet", "sepolia"]).default("mainnet"),
  BASE_MAINNET_RPC_URL: optionalUrl,
  SOLANA_MAINNET_RPC_URL: optionalUrl,
  SOLANA_DEVNET_RPC_URL: optionalUrl,
  RESOLVER_SIGNING_KEY: z.string().min(32), IDENTITY_LOOKUP_KEY: z.string().min(32), PENDING_DELIVERY_PRIVATE_KEY: z.string().min(32),
  CIRCLE_IRIS_BASE_URL: optionalUrl, STARKNET_RELAYER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_RELAYER_KEY_OR_KEYSTORE: z.string().min(1).optional(),
  STARKNET_DEPLOYER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(), STARKNET_DEPLOYER_PRIVATE_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]{1,64}$/).optional(),
  DEPLOYMENT_MANIFEST_PATH: z.string().optional(),
  CCTP_ADMITTED_ROUTES: z.string().default(""),
  STARKNET_PRIVATE_ADMITTED: envBoolean.default(false),
  /** Local/demo escape hatch: skip retained phase evidence; still requires real RPCs + workers. */
  MAINNET_FORCE_ADMIT: envBoolean.default(false),
  RUN_INDEXER: envBoolean.default(false),
  RUN_RELAYER: envBoolean.default(false),
  STARKNET_FALLBACK_RPC_URL: optionalUrl,
  STARKNET_RELAYER_ALERT_BALANCE_WEI: z.coerce.bigint().positive().default(15_000_000_000_000_000_000n),
  PILOT_MAX_USDC_PER_TX: z.coerce.number().int().positive().optional(),
  PILOT_PAUSED_ROUTES: z.string().default(""),
}).passthrough();
export type Config = ReturnType<typeof loadConfig>;

const FELT = /^0x[0-9a-f]+$/i;

function sameFelt(left: unknown, right: unknown): boolean {
  try { return BigInt(String(left)) === BigInt(String(right)); } catch { return false; }
}

/** A route-admission flag is insufficient: bind admission to retained, redacted live evidence. */
export function verifyStarknetPrivateEvidence(
  manifest: ReturnType<typeof deploymentManifestSchema.parse>,
  manifestPath: string,
  manifestHash: string,
): boolean {
  const evidencePath = path.resolve(
    path.dirname(manifestPath),
    "..",
    manifest.evidence.root,
    manifestHash,
    "starknet-private-mainnet",
    "summary.json",
  );
  let evidence: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(evidencePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    evidence = parsed as Record<string, unknown>;
  } catch { return false; }
  const denomination = typeof evidence.denomination === "string" ? evidence.denomination : "";
  const pool = manifest.pools.find((candidate) => candidate.denomination === denomination);
  const fundedEvent = evidence.fundedEvent as Record<string, unknown> | undefined;
  const claimedEvent = evidence.claimedEvent as Record<string, unknown> | undefined;
  return evidence.version === 1
    && evidence.network === "mainnet"
    && evidence.routeId === "starknet-private"
    && evidence.manifestHash === manifestHash
    && manifest.approvedCctpDenominations.some((approved) => approved === denomination)
    && Boolean(pool)
    && pool?.verification.status === "verified"
    && sameFelt(evidence.escrowPool, pool?.address)
    && FELT.test(String(evidence.depositTxHash ?? ""))
    && FELT.test(String(evidence.claimTxHash ?? ""))
    && evidence.encryptedNoteRecorded === true
    && evidence.finalIndexedState === "claimed"
    && sameFelt(fundedEvent?.escrow, pool?.address)
    && fundedEvent?.denomination === denomination
    && sameFelt(claimedEvent?.escrow, pool?.address)
    && claimedEvent?.denomination === denomination;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  // Prefer dedicated STARKNET_RELAYER_*; fall back to MAINNET_RELAYER_* when unset.
  const withRelayerAlias: NodeJS.ProcessEnv = { ...source };
  if (!withRelayerAlias.STARKNET_RELAYER_ADDRESS?.trim() && withRelayerAlias.STARKNET_MAINNET_RELAYER_ADDRESS?.trim()) {
    withRelayerAlias.STARKNET_RELAYER_ADDRESS = withRelayerAlias.STARKNET_MAINNET_RELAYER_ADDRESS;
  }
  if (!withRelayerAlias.STARKNET_RELAYER_PRIVATE_KEY?.trim() && withRelayerAlias.STARKNET_MAINNET_RELAYER_PRIVATE_KEY?.trim()) {
    withRelayerAlias.STARKNET_RELAYER_PRIVATE_KEY = withRelayerAlias.STARKNET_MAINNET_RELAYER_PRIVATE_KEY;
  }
  const parsedEnv = envSchema.parse(withRelayerAlias);
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
  const supportedCctpRoutes = expectedChainId === "SN_MAIN"
    ? new Set(["base", "solana"])
    : new Set(["ethereum", "arbitrum", "base", "solana", "stellar"]);
  for (const route of admittedCctpRoutes) {
    if (!supportedCctpRoutes.has(route)) throw new Error(`unsupported_admitted_route:${route}`);
  }
  const forceAdmit = expectedChainId === "SN_MAIN" && env.MAINNET_FORCE_ADMIT;
  if (expectedChainId === "SN_MAIN") {
    const SOLANA_PUBLIC_ENDPOINTS = [
      "api.mainnet-beta.solana.com",
      "api.mainnet.solana.com",
      "solana-api.projectserum.com",
      "api.devnet.solana.com",
      "api.testnet.solana.com",
    ];
    if (admittedCctpRoutes.has("base") && !env.BASE_MAINNET_RPC_URL?.trim()) {
      throw new Error("base_mainnet_rpc_required");
    }
    if (admittedCctpRoutes.has("solana")) {
      const solanaRpc = env.SOLANA_MAINNET_RPC_URL?.trim();
      const isPublic = Boolean(
        solanaRpc && SOLANA_PUBLIC_ENDPOINTS.some((host) => new URL(solanaRpc).hostname === host),
      );
      if (!solanaRpc || (isPublic && !forceAdmit)) {
        throw new Error("solana_mainnet_rpc_required");
      }
    }
  }
  const starknetPrivateEvidenceVerified = forceAdmit
    || (expectedChainId === "SN_MAIN"
      && verifyStarknetPrivateEvidence(manifest, manifestPath, manifestHash));
  if (
    expectedChainId === "SN_MAIN"
    && env.STARKNET_PRIVATE_ADMITTED
    && !starknetPrivateEvidenceVerified
  ) {
    throw new Error("starknet_private_evidence_required");
  }
  return {
    env,
    port: env.PORT,
    origin: env.API_ORIGIN.replace(/\/$/, ""),
    corsOrigins: env.CORS_ORIGINS.split(",").map((x) => x.trim()).filter(Boolean),
    manifestHash,
    manifest,
    manifestPath,
    admittedCctpRoutes,
    runtimeVerifiedCctpRoutes: new Set<string>(),
    starknetPrivateEvidenceVerified,
    forceAdmit,
    pilotMaxUsdcPerTx: env.PILOT_MAX_USDC_PER_TX,
    pilotPausedRoutes: new Set(env.PILOT_PAUSED_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)),
  };
}

export async function assertStarknetRpcNetwork(config: Config): Promise<void> {
  let chainId: string;
  try { chainId = await new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL }).getChainId(); } catch { throw new Error("starknet_rpc_unavailable"); }
  const expected = config.manifest.chainId === "SN_MAIN" ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA;
  if (chainId !== expected) throw new Error("network_manifest_mismatch");
}

type StarknetChainIdReader = (nodeUrl: string) => Promise<string>;

const readStarknetChainId: StarknetChainIdReader = async (nodeUrl) =>
  new RpcProvider({ nodeUrl }).getChainId();

/**
 * The indexer uses the fallback as an independent read provider. A URL and a
 * distinct hostname are insufficient: reject an unavailable or wrong-network
 * fallback before either worker begins processing escrow state.
 */
export async function assertMainnetFallbackRpcNetwork(
  config: Config,
  readChainId: StarknetChainIdReader = readStarknetChainId,
): Promise<void> {
  if (config.manifest.chainId !== "SN_MAIN") return;
  const workersRequested = config.env.RUN_INDEXER || config.env.RUN_RELAYER || config.env.STARKNET_PRIVATE_ADMITTED;
  if (!workersRequested) return;
  const fallback = config.env.STARKNET_FALLBACK_RPC_URL;
  if (!fallback) throw new Error("mainnet_worker_fallback_rpc_required");
  let chainId: string;
  try {
    chainId = await readChainId(fallback);
  } catch {
    throw new Error("starknet_fallback_rpc_unavailable");
  }
  if (chainId !== constants.StarknetChainId.SN_MAIN) {
    throw new Error("starknet_fallback_rpc_network_mismatch");
  }
}

async function jsonRpc(
  url: string,
  method: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`source_rpc_http_${response.status}`);
  const body = await response.json() as { result?: unknown; error?: unknown };
  if (body.error || body.result === undefined) throw new Error("source_rpc_invalid_response");
  return body.result;
}

/** Verify the actual Base/Solana networks before their mainnet capabilities can be enabled. */
export async function assertMainnetSourceRpcNetworks(
  config: Config,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (config.manifest.chainId !== "SN_MAIN") return;
  const verified = new Set<string>();
  try {
    if (config.admittedCctpRoutes.has("base")) {
      const chainId = await jsonRpc(config.env.BASE_MAINNET_RPC_URL!, "eth_chainId", fetchImpl);
      if (String(chainId).toLowerCase() !== "0x2105") throw new Error("base_rpc_network_mismatch");
      verified.add("base");
    }
    if (config.admittedCctpRoutes.has("solana")) {
      const genesisHash = await jsonRpc(config.env.SOLANA_MAINNET_RPC_URL!, "getGenesisHash", fetchImpl);
      if (genesisHash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
        throw new Error("solana_rpc_network_mismatch");
      }
      verified.add("solana");
    }
  } catch (error) {
    config.runtimeVerifiedCctpRoutes.clear();
    throw error;
  }
  config.runtimeVerifiedCctpRoutes.clear();
  for (const route of verified) config.runtimeVerifiedCctpRoutes.add(route);
}

/**
 * Asserts all preconditions for running workers (relayer/indexer) on mainnet.
 * Must be called after `loadConfig` and before starting any worker loops.
 * On testnet (SN_SEPOLIA) this is a no-op.
 */
export function assertMainnetWorkerReadiness(config: Config): void {
  if (config.manifest.chainId !== "SN_MAIN") return;
  if (!config.manifest.verified)
    throw new Error("mainnet_worker_manifest_not_verified");
  if (config.manifest.router.verification.status !== "verified")
    throw new Error("mainnet_worker_router_not_verified");
  const approved = new Set(config.manifest.approvedCctpDenominations);
  const approvedPools = config.manifest.pools.filter((pool) => approved.has(pool.denomination));
  if (approvedPools.length === 0)
    throw new Error("mainnet_worker_denominations_not_approved");
  if (approvedPools.some((p) => p.verification.status !== "verified"))
    throw new Error("mainnet_worker_pool_not_verified");
  const cctpWorkersRequested = config.env.RUN_RELAYER || config.admittedCctpRoutes.size > 0;
  const privateEscrowWorkerRequested = config.env.STARKNET_PRIVATE_ADMITTED;
  if (!cctpWorkersRequested && !privateEscrowWorkerRequested) return;
  // The indexer is required for every escrow route. CCTP additionally needs
  // the relayer; a Starknet-native deposit does not.
  if (!config.env.RUN_INDEXER) {
    throw new Error(privateEscrowWorkerRequested
      ? "mainnet_private_indexer_required"
      : "mainnet_worker_pair_required");
  }
  if (!config.env.STARKNET_FALLBACK_RPC_URL)
    throw new Error("mainnet_worker_fallback_rpc_required");
  if (new URL(config.env.STARKNET_RPC_URL).hostname === new URL(config.env.STARKNET_FALLBACK_RPC_URL).hostname)
    throw new Error("mainnet_worker_fallback_operator_required");
  if (!cctpWorkersRequested) return;
  if (config.admittedCctpRoutes.size === 0)
    throw new Error("mainnet_worker_no_admitted_routes");
  if (!config.env.RUN_RELAYER)
    throw new Error("mainnet_worker_pair_required");
  const relayerAddress = config.env.STARKNET_RELAYER_ADDRESS;
  const relayerKey = config.env.STARKNET_RELAYER_PRIVATE_KEY ?? config.env.STARKNET_RELAYER_KEY_OR_KEYSTORE;
  if (!relayerAddress || !relayerKey || !/^(?:0x)?[0-9a-fA-F]{1,64}$/.test(relayerKey))
    throw new Error("mainnet_worker_relayer_credentials_missing");
  const deployerAddress = config.env.STARKNET_DEPLOYER_ADDRESS ?? config.manifest.deployer.address;
  if (/^0x[0-9a-f]+$/i.test(deployerAddress) && BigInt(relayerAddress) === BigInt(deployerAddress))
    throw new Error("mainnet_worker_relayer_must_be_separate");
  for (const route of config.admittedCctpRoutes) {
    if (!config.runtimeVerifiedCctpRoutes.has(route))
      throw new Error(`mainnet_worker_source_rpc_unverified:${route}`);
  }
}
