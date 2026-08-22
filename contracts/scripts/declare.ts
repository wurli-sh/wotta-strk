#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider, Signer } from "starknet";
import {
  DENOMINATIONS,
  STARKNET_JS_VERSION,
  deploymentManifestSchema,
  hashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

const DEFAULT_USDC =
  "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb";
const DEFAULT_STRK20_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const POOL_KEYS = ["pool1", "pool10", "pool50", "pool100"] as const;

type ArtifactRecord = {
  path: string;
  classHash: string;
};

async function readExistingManifest(): Promise<DeploymentManifest | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    return deploymentManifestSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function discoverArtifacts(): Promise<Record<string, ArtifactRecord | null>> {
  const candidates = {
    router: path.join(root, "contracts", "target", "dev", "wotta_cctp_router.contract_class.json"),
    pool: path.join(root, "contracts", "target", "dev", "wotta_escrow_pool.contract_class.json"),
  } as const;

  const discovered: Record<string, ArtifactRecord | null> = {
    router: null,
    pool: null,
  };

  for (const [key, candidate] of Object.entries(candidates)) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { class_hash?: string };
      discovered[key] = {
        path: path.relative(root, candidate),
        classHash: parsed.class_hash && /^0x/i.test(parsed.class_hash)
          ? parsed.class_hash
          : "UNDECLARED",
      };
    } catch {
      discovered[key] = null;
    }
  }
  return discovered;
}

function buildBaseManifest(existing: DeploymentManifest | null): DeploymentManifest {
  const manifest = deploymentManifestSchema.parse({
    version: 1,
    chainId: "SN_MAIN",
    network: "mainnet",
    rpcUrlEnv: "STARKNET_RPC_URL",
    manifestHash: "PENDING",
    generatedAt: new Date().toISOString(),
    verified: false,
    verificationNotes:
      "Phase 1 deployment evidence has not been recorded; all routes are disabled.",
    usdc: process.env.WOTTA_MAINNET_USDC?.trim() || existing?.usdc || DEFAULT_USDC,
    strk20Pool:
      process.env.WOTTA_STRK20_POOL?.trim() || existing?.strk20Pool || DEFAULT_STRK20_POOL,
    strk20ClassHash:
      process.env.WOTTA_STRK20_CLASS_HASH?.trim() ||
      existing?.strk20ClassHash ||
      "UNKNOWN",
    deployer: {
      address:
        process.env.STARKNET_DEPLOYER_ADDRESS?.trim() ||
        existing?.deployer.address ||
        "UNKNOWN",
      keySource: "env:STARKNET_DEPLOYER_PRIVATE_KEY",
    },
    tooling: existing?.tooling ?? {
      starknetJs: STARKNET_JS_VERSION,
      walletApiSchema: "0.10.3",
      scarb: "2.17.0",
      snforge: "0.59.0",
    },
    router: existing?.router ?? {
      classHash: "UNDECLARED",
      address: "UNDEPLOYED",
      declareTxHash: "PENDING",
      deployTxHash: "PENDING",
      deployedBlock: "PENDING",
      constructorCalldata: [],
      verification: {
        status: "pending",
        checkedAt: "PENDING",
        notes: "Verification not run yet.",
      },
    },
    pools:
      existing?.pools ??
      DENOMINATIONS.map((denomination, index) => ({
        key: POOL_KEYS[index],
        denomination,
        classHash: "UNDECLARED",
        address: "UNDEPLOYED",
        declareTxHash: "PENDING",
        deployTxHash: "PENDING",
        deployedBlock: "PENDING",
        constructorCalldata: [],
        verification: {
          status: "pending",
          checkedAt: "PENDING",
          notes: "Verification not run yet.",
        },
      })),
  });

  const manifestHash = hashDeploymentManifest({
    ...manifest,
    manifestHash: undefined as never,
  });
  return deploymentManifestSchema.parse({ ...manifest, manifestHash });
}

async function maybeTouchProvider(): Promise<string> {
  const rpcUrl = process.env.STARKNET_RPC_URL?.trim();
  if (!rpcUrl) return "missing STARKNET_RPC_URL";
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  try {
    await provider.getChainId();
    return `rpc ok: ${rpcUrl}`;
  } catch (error) {
    return `rpc unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function ensureSignerIfPresent(): string {
  const privateKey = process.env.STARKNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!privateKey) return "missing STARKNET_DEPLOYER_PRIVATE_KEY";
  new Signer(normalizePrivateKey(privateKey));
  return "deployer key loaded";
}

function normalizePrivateKey(value: string): string {
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(normalized)) return normalized;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

async function main(): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });

  const existing = await readExistingManifest();
  const manifest = buildBaseManifest(existing);
  const artifacts = await discoverArtifacts();

  if (artifacts.router) {
    manifest.router.classHash = artifacts.router.classHash;
  }
  if (artifacts.pool) {
    manifest.pools = manifest.pools.map((pool) => ({
      ...pool,
      classHash: artifacts.pool?.classHash ?? pool.classHash,
    }));
  }

  const signerStatus = ensureSignerIfPresent();
  const providerStatus = await maybeTouchProvider();
  manifest.verificationNotes = [
    "Phase 1 declaration scaffold prepared.",
    signerStatus,
    providerStatus,
    artifacts.router
      ? `router artifact: ${artifacts.router.path}`
      : "router artifact missing; class hash left as placeholder",
    artifacts.pool
      ? `pool artifact: ${artifacts.pool.path}`
      : "pool artifact missing; class hashes left as placeholders",
  ].join(" ");

  manifest.manifestHash = hashDeploymentManifest({
    ...manifest,
    manifestHash: undefined as never,
  });

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        mode: signerStatus.startsWith("missing") ? "placeholder" : "ready",
        manifestPath,
        signerStatus,
        providerStatus,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
