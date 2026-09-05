#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider } from "starknet";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";
import {
  CIRCLE_STARKNET_MAINNET_DOMAIN,
  CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER,
  CIRCLE_STARKNET_MAINNET_TOKEN_MESSENGER,
  CIRCLE_STARKNET_MAINNET_USDC,
  STARKNET_MAINNET_CHAIN_ID,
} from "./mainnet-constants.ts";
import { assertMainnetDeployConfig } from "./mainnet-preflight.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

async function loadManifest(): Promise<DeploymentManifest> {
  return deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

function isLiveFelt(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function feltEq(left: unknown, right: unknown): boolean {
  try { return BigInt(String(left)) === BigInt(String(right)); } catch { return false; }
}

async function callOne(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string> {
  const result = await provider.callContract({ contractAddress, entrypoint, calldata });
  if (result.length !== 1 || result[0] === undefined) throw new Error(`${entrypoint} returned invalid data`);
  return result[0];
}

async function verifyReceipt(
  provider: RpcProvider,
  txHash: string,
  recordedBlock: number | "PENDING" | "UNKNOWN",
): Promise<string[]> {
  if (!isLiveFelt(txHash)) return ["transaction hash is not recorded"];
  try {
    const receipt = await provider.getTransactionReceipt(txHash) as unknown as {
      finality_status?: string;
      execution_status?: string;
      block_number?: number;
    };
    const failures: string[] = [];
    if (!new Set(["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"]).has(receipt.finality_status ?? "")) {
      failures.push(`transaction finality is ${receipt.finality_status ?? "unknown"}`);
    }
    if (receipt.execution_status && receipt.execution_status !== "SUCCEEDED") {
      failures.push(`transaction execution is ${receipt.execution_status}`);
    }
    if (typeof recordedBlock !== "number" || receipt.block_number !== recordedBlock) {
      failures.push(`recorded block ${recordedBlock} does not match receipt block ${receipt.block_number ?? "unknown"}`);
    }
    return failures;
  } catch (error) {
    return [`receipt lookup failed: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function verifyDeclaration(
  provider: RpcProvider,
  artifact: Pick<DeploymentManifest["router"], "classHash" | "compiledClassHash" | "declareTxHash" | "declaredBlock">,
): Promise<string[]> {
  const failures = await verifyReceipt(provider, artifact.declareTxHash, artifact.declaredBlock);
  if (!isLiveFelt(artifact.classHash) || !isLiveFelt(artifact.compiledClassHash)) {
    failures.push("Sierra or CASM class hash is not recorded");
    return failures;
  }
  try {
    await provider.getClassByHash(artifact.classHash);
  } catch (error) {
    failures.push(`declared class lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const tx = await provider.getTransactionByHash(artifact.declareTxHash) as unknown as {
      class_hash?: string;
      compiled_class_hash?: string;
    };
    if (!feltEq(tx.class_hash, artifact.classHash)) failures.push("declare transaction Sierra hash mismatch");
    if (!feltEq(tx.compiled_class_hash, artifact.compiledClassHash)) failures.push("declare transaction CASM hash mismatch");
  } catch (error) {
    failures.push(`declare transaction lookup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failures;
}

async function verifyGetter(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
  expected: unknown,
  failures: string[],
  calldata: string[] = [],
): Promise<void> {
  try {
    const actual = await callOne(provider, contractAddress, entrypoint, calldata);
    if (!feltEq(actual, expected)) failures.push(`${entrypoint} mismatch: got ${actual}`);
  } catch (error) {
    failures.push(`${entrypoint} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const manifest = await loadManifest();
  assertMainnetDeployConfig(manifest);
  const checkedAt = new Date().toISOString();
  const rpcUrl = process.env.STARKNET_MAINNET_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("missing STARKNET_MAINNET_RPC_URL — cannot perform RPC verification");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (await provider.getChainId() !== STARKNET_MAINNET_CHAIN_ID) {
    throw new Error("wrong_network: deployment verification requires SN_MAIN");
  }

  const globalFailures: string[] = [];
  if (!feltEq(manifest.usdc, CIRCLE_STARKNET_MAINNET_USDC)) {
    globalFailures.push("manifest native USDC does not match Circle mainnet USDC");
  }
  if (manifest.approvedCctpDenominations.length === 0) {
    globalFailures.push("approvedCctpDenominations is empty");
  }
  if (!isLiveFelt(manifest.authority.owner)) globalFailures.push("router owner is not recorded");

  await verifyGetter(provider, CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER, "get_local_domain", CIRCLE_STARKNET_MAINNET_DOMAIN, globalFailures);
  await verifyGetter(provider, CIRCLE_STARKNET_MAINNET_TOKEN_MESSENGER, "local_message_transmitter", CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER, globalFailures);

  const routerFailures = await verifyDeclaration(provider, manifest.router);
  if (!isLiveFelt(manifest.router.address)) {
    routerFailures.push("router address is not recorded");
  } else {
    try {
      const remoteClassHash = await provider.getClassHashAt(manifest.router.address);
      if (!feltEq(remoteClassHash, manifest.router.classHash)) routerFailures.push("deployed class hash mismatch");
    } catch (error) {
      routerFailures.push(`deployed class lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    routerFailures.push(...await verifyReceipt(provider, manifest.router.deployTxHash, manifest.router.deployedBlock));
    await Promise.all([
      verifyGetter(provider, manifest.router.address, "message_transmitter", CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER, routerFailures),
      verifyGetter(provider, manifest.router.address, "token_messenger", CIRCLE_STARKNET_MAINNET_TOKEN_MESSENGER, routerFailures),
      verifyGetter(provider, manifest.router.address, "usdc", manifest.usdc, routerFailures),
      verifyGetter(provider, manifest.router.address, "owner", manifest.authority.owner, routerFailures),
      // Live pilot posture after admit-mainnet-router: unpaused with Base (6) + Solana (5).
      verifyGetter(provider, manifest.router.address, "paused", 0, routerFailures),
      verifyGetter(provider, manifest.router.address, "is_source_domain_admitted", 1, routerFailures, ["5"]),
      verifyGetter(provider, manifest.router.address, "is_source_domain_admitted", 1, routerFailures, ["6"]),
      verifyGetter(provider, manifest.router.address, "is_source_domain_admitted", 0, routerFailures, ["0"]),
      verifyGetter(provider, manifest.router.address, "is_source_domain_admitted", 0, routerFailures, ["3"]),
      verifyGetter(provider, manifest.router.address, "is_source_domain_admitted", 0, routerFailures, ["27"]),
    ]);
  }
  const routerVerified = routerFailures.length === 0;
  manifest.router.verification = {
    status: routerVerified ? "verified" : "failed",
    checkedAt,
    notes: routerVerified
      ? "Sierra/CASM, receipts, Circle bindings, owner, unpaused state, and admitted Base/Solana source domains verified over SN_MAIN RPC."
      : routerFailures.join("; "),
  };

  const approved = new Set(manifest.approvedCctpDenominations);
  let allApprovedPoolsVerified = approved.size > 0;
  const poolFailureSummaries: string[] = [];
  manifest.pools = await Promise.all(manifest.pools.map(async (pool) => {
    if (!approved.has(pool.denomination)) {
      if (isLiveFelt(pool.address)) {
        allApprovedPoolsVerified = false;
        poolFailureSummaries.push(`${pool.key}: unapproved pool is deployed`);
        return { ...pool, verification: { status: "failed" as const, checkedAt, notes: "Unapproved mainnet pool is deployed." } };
      }
      return { ...pool, verification: { status: "skipped" as const, checkedAt, notes: "Not approved for the mainnet pilot." } };
    }

    const failures = await verifyDeclaration(provider, pool);
    if (!isLiveFelt(pool.address)) {
      failures.push("pool address is not recorded");
    } else {
      try {
        const remoteClassHash = await provider.getClassHashAt(pool.address);
        if (!feltEq(remoteClassHash, pool.classHash)) failures.push("deployed class hash mismatch");
      } catch (error) {
        failures.push(`deployed class lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      failures.push(...await verifyReceipt(provider, pool.deployTxHash, pool.deployedBlock));
      await Promise.all([
        verifyGetter(provider, pool.address, "router", manifest.router.address, failures),
        verifyGetter(provider, pool.address, "usdc", manifest.usdc, failures),
        verifyGetter(provider, pool.address, "privacy_pool", manifest.strk20Pool, failures),
        verifyGetter(provider, pool.address, "denomination", pool.denomination, failures),
        verifyGetter(provider, pool.address, "chain_id", STARKNET_MAINNET_CHAIN_ID, failures),
      ]);
    }
    const verified = failures.length === 0;
    if (!verified) {
      allApprovedPoolsVerified = false;
      poolFailureSummaries.push(`${pool.key}: ${failures.join("; ")}`);
    }
    return {
      ...pool,
      verification: {
        status: verified ? ("verified" as const) : ("failed" as const),
        checkedAt,
        notes: verified ? "Sierra/CASM, receipts, and all constructor bindings verified over SN_MAIN RPC." : failures.join("; "),
      },
    };
  }));

  const failures = [
    ...globalFailures,
    ...routerFailures.map((failure) => `router: ${failure}`),
    ...poolFailureSummaries,
  ];
  manifest.verified = globalFailures.length === 0 && routerVerified && allApprovedPoolsVerified;
  manifest.verificationNotes = manifest.verified
    ? "Mainnet router and approved pools passed on-chain declaration, deployment, receipt, and binding verification. Router is unpaused with Base (6) and Solana (5) admitted; Ethereum/Arbitrum/Stellar remain denied. API route enablement stays evidence-gated / operator-controlled."
    : `Verification failed: ${failures.join("; ")}`;
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({
    status: manifest.verified ? "ok" : "failed",
    verificationStatus: manifest.verified ? "verified" : "failed",
    failures,
    manifestPath,
    checkedAt,
  }, null, 2)}\n`);
  if (!manifest.verified) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
