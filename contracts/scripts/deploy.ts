#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, shortString, stark } from "starknet";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";
import {
  CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER,
  CIRCLE_STARKNET_MAINNET_TOKEN_MESSENGER,
  CIRCLE_STARKNET_MAINNET_USDC,
  STARKNET_MAINNET_CHAIN_ID,
} from "./mainnet-constants.ts";
import { assertMainnetDeployerIdentity, assertMainnetDeployConfig, syncMainnetPilotIdentities } from "./mainnet-preflight.ts";
import { assertMainnetDeployerSignerReady, createMainnetDeployerAccount } from "./mainnet-rpc.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

async function loadManifest(): Promise<DeploymentManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return deploymentManifestSchema.parse(JSON.parse(raw));
}

async function persistManifest(manifest: DeploymentManifest): Promise<void> {
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function canDeploy(): { ok: boolean; reason?: string } {
  if (!process.env.STARKNET_MAINNET_RPC_URL?.trim()) {
    return { ok: false, reason: "missing STARKNET_MAINNET_RPC_URL" };
  }
  if (!process.env.STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY?.trim()) {
    return {
      ok: false,
      reason: "missing STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY",
    };
  }
  if (!process.env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim()) {
    return {
      ok: false,
      reason: "missing STARKNET_MAINNET_DEPLOYER_ADDRESS",
    };
  }
  return { ok: true };
}

async function instantiateAccount(): Promise<Account> {
  const rpcUrl = process.env.STARKNET_MAINNET_RPC_URL?.trim();
  if (!rpcUrl) throw new Error("mainnet_blocked:missing STARKNET_MAINNET_RPC_URL");
  return createMainnetDeployerAccount(rpcUrl);
}

/** Record accepted deployments left pending if a process exits while waiting. */
async function reconcileAcceptedDeployments(manifest: DeploymentManifest, provider: RpcProvider): Promise<boolean> {
  let changed = false;
  const acceptedBlock = async (label: string, txHash: string): Promise<number> => {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (
      !("execution_status" in receipt) ||
      !("finality_status" in receipt) ||
      receipt.execution_status !== "SUCCEEDED" ||
      receipt.finality_status !== "ACCEPTED_ON_L2" ||
      !("block_number" in receipt) ||
      typeof receipt.block_number !== "number"
    ) {
      throw new Error(`mainnet_blocked:${label}_deployment_not_accepted:${txHash}`);
    }
    return receipt.block_number;
  };

  if (
    manifest.router.address !== "UNDEPLOYED" &&
    manifest.router.deployTxHash !== "PENDING" &&
    manifest.router.deployedBlock === "PENDING"
  ) {
    manifest.router.deployedBlock = await acceptedBlock("router", manifest.router.deployTxHash);
    changed = true;
  }
  for (let i = 0; i < manifest.pools.length; i++) {
    const pool = manifest.pools[i]!;
    if (pool.address !== "UNDEPLOYED" && pool.deployTxHash !== "PENDING" && pool.deployedBlock === "PENDING") {
      manifest.pools[i] = {
        ...pool,
        deployedBlock: await acceptedBlock(`pool_${pool.key}`, pool.deployTxHash),
      };
      changed = true;
    }
  }
  return changed;
}

async function main(): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  let manifest = await loadManifest();
  const sepolia = JSON.parse(await readFile(path.join(root, "deployments", "sepolia.json"), "utf8")) as { deployer?: { address?: string } };
  assertMainnetDeployerIdentity(process.env, sepolia.deployer?.address ?? "");
  manifest = syncMainnetPilotIdentities(manifest, process.env);
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  assertMainnetDeployConfig(manifest);
  const deployCheck = canDeploy();

  if (!deployCheck.ok) {
    throw new Error(`deployment_credentials_missing: ${deployCheck.reason}`);
  }

  const account = await instantiateAccount();

  // Guard: must be SN_MAIN
  const chainId = await account.provider.getChainId();
  if (chainId !== STARKNET_MAINNET_CHAIN_ID) {
    throw new Error(`wrong_network: expected SN_MAIN, got ${chainId}`);
  }
  await assertMainnetDeployerSignerReady(account);

  const submit = process.env.MAINNET_DEPLOY_SUBMIT === "1";
  if (!submit) {
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      mode: "ready_no_submit",
      chainId,
      owner: manifest.authority.owner,
      deployer: manifest.deployer.address,
      routerClassHash: manifest.router.classHash,
      approvedPools: manifest.pools
        .filter((pool) => manifest.approvedCctpDenominations.includes(pool.denomination))
        .map((pool) => ({ key: pool.key, denomination: pool.denomination, classHash: pool.classHash })),
      submitRequiredEnv: "MAINNET_DEPLOY_SUBMIT=1",
    }, null, 2)}\n`);
    return;
  }

  if (await reconcileAcceptedDeployments(manifest, account.provider)) {
    manifest.verificationNotes = "Phase 2 deploy reconciliation completed.";
  }
  await persistManifest(manifest);

  const ownerAddress = manifest.authority.owner;
  if (BigInt(manifest.usdc) !== BigInt(CIRCLE_STARKNET_MAINNET_USDC)) {
    throw new Error("mainnet manifest USDC does not match Circle native USDC");
  }
  const usdcAddress = manifest.usdc;

  const notes: string[] = ["Phase 2 deploy."];

  // Deploy router if not yet deployed
  if (
    manifest.router.classHash !== "UNDECLARED" &&
    manifest.router.address === "UNDEPLOYED"
  ) {
    notes.push("deploying router…");
    const routerConstructor = [
      ownerAddress,
      CIRCLE_STARKNET_MAINNET_MESSAGE_TRANSMITTER,
      usdcAddress,
      CIRCLE_STARKNET_MAINNET_TOKEN_MESSENGER,
    ];
    const { contract_address: routerAddress, transaction_hash: routerTxHash } =
      await account.deployContract({
        classHash: manifest.router.classHash,
        constructorCalldata: routerConstructor,
        salt: stark.randomAddress(),
        unique: true,
      });
    manifest.router.address = routerAddress;
    manifest.router.deployTxHash = routerTxHash;
    manifest.router.deployedBlock = "PENDING";
    manifest.router.constructorCalldata = routerConstructor;
    notes.push(`router deployment submitted: ${routerTxHash}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
    await account.provider.waitForTransaction(routerTxHash);
    const block = await account.provider.getTransactionReceipt(routerTxHash);
    manifest.router.deployedBlock = "block_number" in block && typeof block.block_number === "number"
      ? block.block_number
      : "PENDING";
    notes.push(`router deployed at ${routerAddress}`);
    manifest.verificationNotes = notes.join(" ");
    await persistManifest(manifest);
  }

  // Deploy each pool if not yet deployed and router is known
  for (let i = 0; i < manifest.pools.length; i++) {
    const pool = manifest.pools[i]!;
    if (!manifest.approvedCctpDenominations.includes(pool.denomination)) continue;
    if (pool.classHash !== "UNDECLARED" && pool.address === "UNDEPLOYED") {
      if (manifest.router.address === "UNDEPLOYED") {
        notes.push(`pool ${pool.key}: skipped — router not yet deployed`);
        continue;
      }
      notes.push(`deploying pool ${pool.key}…`);
      // pool constructor: (privacy_pool, usdc, router, denomination, chain_id_felt)
      const poolConstructor = [
        manifest.strk20Pool,
        usdcAddress,
        manifest.router.address,
        pool.denomination,
        shortString.encodeShortString("SN_MAIN"),
      ];
      const { contract_address: poolAddress, transaction_hash: poolTxHash } =
        await account.deployContract({
          classHash: pool.classHash,
          constructorCalldata: poolConstructor,
          salt: stark.randomAddress(),
          unique: true,
        });
      manifest.pools[i] = {
        ...pool,
        address: poolAddress,
        deployTxHash: poolTxHash,
        deployedBlock: "PENDING",
        constructorCalldata: poolConstructor,
      };
      notes.push(`pool ${pool.key} deployment submitted: ${poolTxHash}`);
      manifest.verificationNotes = notes.join(" ");
      await persistManifest(manifest);
      await account.provider.waitForTransaction(poolTxHash);
      const poolBlock = await account.provider.getTransactionReceipt(poolTxHash);
      manifest.pools[i] = {
        ...manifest.pools[i]!,
        deployedBlock: "block_number" in poolBlock && typeof poolBlock.block_number === "number"
          ? poolBlock.block_number
          : "PENDING",
      };
      notes.push(`pool ${pool.key} deployed at ${poolAddress}`);
      manifest.verificationNotes = notes.join(" ");
      await persistManifest(manifest);
    }
  }

  if (manifest.router.address === "UNDEPLOYED") throw new Error("router was not deployed");
  const missingApprovedPools = manifest.pools.filter((pool) =>
    manifest.approvedCctpDenominations.includes(pool.denomination)
      && pool.address === "UNDEPLOYED");
  if (missingApprovedPools.length > 0) {
    throw new Error(`approved pools were not deployed: ${missingApprovedPools.map((pool) => pool.key).join(",")}`);
  }

  manifest.verificationNotes = notes.join(" ");
  await persistManifest(manifest);
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        mode: "deployed",
        manifestPath,
        deployer: account.address,
        router: manifest.router.address,
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
