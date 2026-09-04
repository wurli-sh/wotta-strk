#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider, hash, type CompiledContract, type CompiledSierraCasm } from "starknet";
import {
  DENOMINATIONS,
  STARKNET_JS_VERSION,
  deploymentManifestSchema,
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";
import {
  assertDeclareWithinCeiling,
  assertBalanceCoversBounds,
  assertProviderIsMainnet,
  createMainnetDeployerAccount,
  deployerStrkBalance,
  estimateDeclareBoundStrk,
  overallFeeStrk,
  requireMainnetRpcUrl,
} from "./mainnet-rpc.ts";
import { assertMainnetDeployerIdentity, assertMainnetManifest, syncMainnetPilotIdentities } from "./mainnet-preflight.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

const DEFAULT_USDC =
  "0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb";
const DEFAULT_STRK20_POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const POOL_KEYS = ["pool01", "pool1", "pool10", "pool50", "pool100"] as const;

type ArtifactRecord = {
  path: string;
  casmPath: string;
  classHash: string;
  compiledClassHash: string;
  contract: CompiledContract;
  casm: CompiledSierraCasm;
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
    router: {
      sierra: path.join(root, "contracts", "target", "dev", "wotta_contracts_WottaCctpRouter.contract_class.json"),
      casm: path.join(root, "contracts", "target", "dev", "wotta_contracts_WottaCctpRouter.compiled_contract_class.json"),
    },
    pool: {
      sierra: path.join(root, "contracts", "target", "dev", "wotta_contracts_WottaEscrowPool.contract_class.json"),
      casm: path.join(root, "contracts", "target", "dev", "wotta_contracts_WottaEscrowPool.compiled_contract_class.json"),
    },
  } as const;

  const discovered: Record<string, ArtifactRecord | null> = {
    router: null,
    pool: null,
  };

  for (const [key, candidate] of Object.entries(candidates)) {
    try {
      const contract = JSON.parse(await readFile(candidate.sierra, "utf8")) as CompiledContract;
      const casm = JSON.parse(await readFile(candidate.casm, "utf8")) as CompiledSierraCasm;
      discovered[key] = {
        path: path.relative(root, candidate.sierra),
        casmPath: path.relative(root, candidate.casm),
        classHash: hash.computeContractClassHash(contract),
        compiledClassHash: hash.computeCompiledClassHash(casm),
        contract,
        casm,
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
    rpcUrlEnv: "STARKNET_MAINNET_RPC_URL",
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
        process.env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim() ||
        existing?.deployer.address ||
        "UNKNOWN",
      keySource: "env:STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY",
    },
    tooling: existing?.tooling ?? {
      starknetJs: STARKNET_JS_VERSION,
      walletApiSchema: "0.10.3",
      scarb: "2.17.0",
      snforge: "0.59.0",
    },
    authority: {
      ...(existing?.authority ?? {}),
      owner:
        process.env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim() ||
        existing?.authority?.owner ||
        "PENDING",
    },
    approvedCctpDenominations: existing?.approvedCctpDenominations ?? [],
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

  const manifestHash = rehashDeploymentManifest(manifest);
  return deploymentManifestSchema.parse({ ...manifest, manifestHash });
}

async function persistManifest(manifest: DeploymentManifest): Promise<void> {
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function maybeTouchProvider(): Promise<string> {
  try {
    const rpcUrl = requireMainnetRpcUrl();
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    await assertProviderIsMainnet(provider);
    return "rpc ok";
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^mainnet_blocked:/, "") : String(error);
  }
}

function ensureSignerIfPresent(): string {
  const privateKey = process.env.STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!privateKey) return "missing STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY";
  const address = process.env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim();
  if (!address) return "missing STARKNET_MAINNET_DEPLOYER_ADDRESS";
  if (!/^0x[0-9a-fA-F]+$/.test(address)) throw new Error("invalid STARKNET_MAINNET_DEPLOYER_ADDRESS");
  createMainnetDeployerAccount(requireMainnetRpcUrl());
  return "deployer key loaded";
}

async function estimateAndGateDeclare(
  label: "router" | "escrow",
  artifact: ArtifactRecord,
  notes: string[],
): Promise<Awaited<ReturnType<typeof estimateDeclareBoundStrk>>> {
  const primaryUrl = requireMainnetRpcUrl();
  const primary = createMainnetDeployerAccount(primaryUrl);
  await assertProviderIsMainnet(primary.provider);
  const primaryEstimate = await estimateDeclareBoundStrk(primary, artifact);
  assertDeclareWithinCeiling(label, primaryEstimate.overallFeeFri);
  notes.push(
    `${label} primary declare bound ${overallFeeStrk(primaryEstimate.overallFeeFri).toFixed(4)} STRK (tip 0, 20% overhead)`,
  );
  return primaryEstimate;
}

async function main(): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });

  const existing = await readExistingManifest();
  if (!existing) throw new Error("mainnet_blocked:deployment_manifest_missing");
  const sepolia = JSON.parse(await readFile(path.join(root, "deployments", "sepolia.json"), "utf8")) as { deployer?: { address?: string } };
  assertMainnetDeployerIdentity(process.env, sepolia.deployer?.address ?? "");

  // Autosync deployer === owner from .env, then rehash before any gate.
  const synced = syncMainnetPilotIdentities(existing, process.env);
  synced.generatedAt = new Date().toISOString();
  synced.manifestHash = rehashDeploymentManifest(synced);
  await persistManifest(synced);
  assertMainnetManifest(synced);

  const manifest = buildBaseManifest(synced);
  const artifacts = await discoverArtifacts();

  if (artifacts.router) {
    manifest.router.classHash = artifacts.router.classHash;
    manifest.router.compiledClassHash = artifacts.router.compiledClassHash;
  }
  if (artifacts.pool) {
    manifest.pools = manifest.pools.map((pool) => ({
      ...pool,
      classHash: artifacts.pool?.classHash ?? pool.classHash,
      compiledClassHash: artifacts.pool?.compiledClassHash ?? pool.compiledClassHash,
    }));
  }

  const signerStatus = ensureSignerIfPresent();
  const providerStatus = await maybeTouchProvider();
  if (!artifacts.router || !artifacts.pool) throw new Error("mainnet_blocked:compiled_contract_artifacts_missing");
  if (providerStatus !== "rpc ok") throw new Error(`mainnet_blocked:${providerStatus}`);
  const notes: string[] = [
    "Phase 2 declaration.",
    signerStatus,
    providerStatus,
    `router artifacts: ${artifacts.router.path}, ${artifacts.router.casmPath}`,
    `pool artifacts: ${artifacts.pool.path}, ${artifacts.pool.casmPath}`,
  ];

  const submit = process.env.MAINNET_DECLARE_SUBMIT === "1";
  const account = createMainnetDeployerAccount(requireMainnetRpcUrl());
  const provider = account.provider;
  await assertProviderIsMainnet(provider);

  const routerBounds = await estimateAndGateDeclare("router", artifacts.router, notes);
  const escrowBounds = await estimateAndGateDeclare("escrow", artifacts.pool, notes);
  const balance = await deployerStrkBalance(account);
  assertBalanceCoversBounds(balance, [routerBounds.overallFeeFri, escrowBounds.overallFeeFri]);
  notes.push(`deployer balance ${overallFeeStrk(balance).toFixed(4)} STRK covers both declare bounds`);

  if (!submit) {
    notes.push("preflight passed; set MAINNET_DECLARE_SUBMIT=1 to submit declarations");
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          mode: "estimate_only",
          manifestPath,
          signerStatus,
          providerStatus,
          balanceStrk: overallFeeStrk(balance),
          boundsStrk: {
            router: overallFeeStrk(routerBounds.overallFeeFri),
            escrow: overallFeeStrk(escrowBounds.overallFeeFri),
            total: overallFeeStrk(routerBounds.overallFeeFri + escrowBounds.overallFeeFri),
          },
          artifactHashes: {
            router: { classHash: artifacts.router.classHash, compiledClassHash: artifacts.router.compiledClassHash },
            escrow: { classHash: artifacts.pool.classHash, compiledClassHash: artifacts.pool.compiledClassHash },
          },
          notes,
          submitRequiredEnv: "MAINNET_DECLARE_SUBMIT=1",
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Declare router if not yet declared
  if (
    artifacts.router &&
    manifest.router.classHash !== "UNDECLARED" &&
    manifest.router.declareTxHash === "PENDING"
  ) {
    notes.push("submitting router declareContract…");
    const { transaction_hash: routerTxHash, class_hash: routerClassHash } =
      await account.declare(
        { contract: artifacts.router.contract, casm: artifacts.router.casm },
        { tip: 0n, resourceBounds: routerBounds.resourceBounds },
      );
    if (BigInt(routerClassHash) !== BigInt(artifacts.router.classHash)) {
      throw new Error("router_sierra_hash_mismatch");
    }
    manifest.router.declareTxHash = routerTxHash;
    manifest.router.classHash = routerClassHash;
    manifest.router.compiledClassHash = artifacts.router.compiledClassHash;
    manifest.router.declaredBlock = "PENDING";
    notes.push(`router declareTxHash submitted: ${routerTxHash}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
    const receipt = await provider.waitForTransaction(routerTxHash);
    manifest.router.declaredBlock = "block_number" in receipt && typeof receipt.block_number === "number"
      ? receipt.block_number
      : "PENDING";
    notes.push(`router declaration confirmed: ${routerTxHash}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
  }

  // Declare pool if not yet declared (same class for all pool denominations)
  const anyPoolUndeclared = manifest.pools.some((p) => p.declareTxHash === "PENDING");
  if (artifacts.pool && anyPoolUndeclared) {
    notes.push("submitting pool declareContract…");
    const { transaction_hash: poolTxHash, class_hash: poolClassHash } =
      await account.declare(
        { contract: artifacts.pool.contract, casm: artifacts.pool.casm },
        { tip: 0n, resourceBounds: escrowBounds.resourceBounds },
      );
    if (BigInt(poolClassHash) !== BigInt(artifacts.pool.classHash)) {
      throw new Error("pool_sierra_hash_mismatch");
    }
    manifest.pools = manifest.pools.map((p) =>
      p.declareTxHash === "PENDING"
        ? {
            ...p,
            declareTxHash: poolTxHash,
            declaredBlock: "PENDING",
            classHash: poolClassHash,
            compiledClassHash: artifacts.pool!.compiledClassHash,
          }
        : p,
    );
    notes.push(`pool declareTxHash submitted: ${poolTxHash}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
    const receipt = await provider.waitForTransaction(poolTxHash);
    const declaredBlock = "block_number" in receipt && typeof receipt.block_number === "number"
      ? receipt.block_number
      : "PENDING";
    manifest.pools = manifest.pools.map((p) =>
      p.declareTxHash === poolTxHash ? { ...p, declaredBlock } : p,
    );
    notes.push(`pool declaration confirmed: ${poolTxHash}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
  }

  manifest.verificationNotes = notes.join(" ");
  await persistManifest(manifest);

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        mode: "declared",
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
