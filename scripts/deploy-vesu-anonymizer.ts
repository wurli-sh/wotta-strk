#!/usr/bin/env node
/**
 * Declare and deploy the exact pinned Vesu lending anonymizer on SN_MAIN.
 *
 * Dry-run (default):
 *   pnpm deploy:vesu-anonymizer
 * Submit:
 *   MAINNET_VESU_ANONYMIZER_SUBMIT=1 pnpm deploy:vesu-anonymizer
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hash,
  num,
  type CompiledContract,
  type CompiledSierraCasm,
  type RpcProvider,
} from "starknet";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../packages/shared/src/index.ts";
import {
  assertBalanceCoversBounds,
  assertMainnetDeployerSignerReady,
  assertProviderIsMainnet,
  createMainnetDeployerAccount,
  deployerStrkBalance,
  maxFeeForBounds,
  overallFeeStrk,
  requireMainnetRpcUrl,
} from "../contracts/scripts/mainnet-rpc.ts";
import { assertMainnetDeployerIdentity, assertMainnetManifest } from "../contracts/scripts/mainnet-preflight.ts";
import { VESU_ANONYMIZER_SOURCE } from "./vesu-anonymizer-pins.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "deployments", "mainnet.json");
const artifactBase = path.join(
  root,
  ".vendor",
  "starknet-privacy-vesu",
  "target",
  "release",
  "vesu_lending_anonymizer_VesuLendingAnonymizer",
);
const sierraPath = `${artifactBase}.contract_class.json`;
const casmPath = `${artifactBase}.compiled_contract_class.json`;
const deploymentSalt = num.toHex(hash.starknetKeccak("wotta-vesu-anonymizer-rc2-v1"));
const DECLARE_CEILING_STRK = 10;
const DEPLOY_CEILING_STRK = 2;

const felt = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value);

async function loadManifest(): Promise<DeploymentManifest> {
  return deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

async function persistManifest(manifest: DeploymentManifest): Promise<void> {
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function acceptedBlock(provider: RpcProvider, label: string, txHash: string): Promise<number> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (
    !("execution_status" in receipt)
    || !("finality_status" in receipt)
    || receipt.execution_status !== "SUCCEEDED"
    || !["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"].includes(receipt.finality_status)
    || !("block_number" in receipt)
    || typeof receipt.block_number !== "number"
  ) {
    throw new Error(`mainnet_blocked:${label}_not_accepted:${txHash}`);
  }
  return receipt.block_number;
}

function assertWithinCeiling(label: string, boundFri: bigint, ceilingStrk: number): void {
  if (overallFeeStrk(boundFri) > ceilingStrk) {
    throw new Error(
      `mainnet_blocked:${label}_bound_exceeds_ceiling:${overallFeeStrk(boundFri).toFixed(4)}_STRK>${ceilingStrk}_STRK`,
    );
  }
}

async function writeEvidenceScaffold(manifest: DeploymentManifest): Promise<void> {
  const earn = manifest.vesuEarn;
  if (!earn) return;
  const dir = path.join(root, "evidence", manifest.manifestHash, "vesu-earn");
  await mkdir(dir, { recursive: true });
  const writeIfMissing = async (file: string, contents: string): Promise<void> => {
    try {
      await writeFile(file, contents, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  };
  await writeFile(
    path.join(dir, "deployment.json"),
    `${JSON.stringify({
      network: manifest.chainId,
      manifestHash: manifest.manifestHash,
      sourceCommit: VESU_ANONYMIZER_SOURCE.commit,
      classHash: earn.anonymizerClassHash,
      compiledClassHash: earn.anonymizerCompiledClassHash,
      declareTxHash: earn.anonymizerDeclareTxHash,
      declaredBlock: earn.anonymizerDeclaredBlock,
      address: earn.anonymizerAddress,
      deployTxHash: earn.anonymizerDeployTxHash,
      deployedBlock: earn.anonymizerDeployedBlock,
      constructorCalldata: [],
    }, null, 2)}\n`,
  );
  await writeIfMissing(
    path.join(dir, "REVIEW.md"),
    `status: waived\nreviewer: n/a\nreviewed_at: PENDING\nsource_commit: ${VESU_ANONYMIZER_SOURCE.commit}\nsierra_class_hash: ${VESU_ANONYMIZER_SOURCE.expectedSierraClassHash}\ncompiled_class_hash: ${VESU_ANONYMIZER_SOURCE.expectedCompiledClassHash}\nfindings_disposition: waived\n\n# Vesu lending anonymizer — review disposition\n\nIndependent REVIEW.md acceptance is not required by pnpm check:vesu-earn. Admission uses source parity, deploy bindings, and Ready deposit/redeem smoke.\n`,
  );
  await writeIfMissing(
    path.join(dir, "smoke.json"),
    `${JSON.stringify({
      status: "pending",
      network: "SN_MAIN",
      manifestHash: manifest.manifestHash,
      anonymizerAddress: earn.anonymizerAddress,
      underlyingAddress: earn.underlyingAddress,
      vTokenAddress: earn.vTokenAddress,
      depositTxHash: null,
      redeemTxHash: null,
      depositAmount: "100000",
      redeemShares: null,
      privateVusdcDiscovered: false,
      privateUsdcRediscovered: false,
      evidenceRedacted: true,
      notes: "Populate only from the Ready Mainnet 0.1-USDC deposit/discovery/redeem smoke.",
    }, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const manifest = await loadManifest();
  assertMainnetManifest(manifest);
  const earn = manifest.vesuEarn;
  if (!earn) throw new Error("mainnet_blocked:vesu_earn_manifest_missing");
  if (earn.status === "verified") throw new Error("mainnet_blocked:vesu_earn_already_verified");

  const sepolia = JSON.parse(await readFile(path.join(root, "deployments", "sepolia.json"), "utf8")) as {
    deployer?: { address?: string };
  };
  assertMainnetDeployerIdentity(process.env, sepolia.deployer?.address ?? "");

  const contract = JSON.parse(await readFile(sierraPath, "utf8")) as CompiledContract;
  const casm = JSON.parse(await readFile(casmPath, "utf8")) as CompiledSierraCasm;
  const classHash = num.toHex(hash.computeContractClassHash(contract));
  const compiledClassHash = num.toHex(hash.computeCompiledClassHash(casm));
  if (
    BigInt(classHash) !== BigInt(VESU_ANONYMIZER_SOURCE.expectedSierraClassHash)
    || BigInt(compiledClassHash) !== BigInt(VESU_ANONYMIZER_SOURCE.expectedCompiledClassHash)
    || BigInt(classHash) !== BigInt(earn.anonymizerClassHash)
    || BigInt(compiledClassHash) !== BigInt(earn.anonymizerCompiledClassHash)
  ) {
    throw new Error("mainnet_blocked:vesu_anonymizer_artifact_hash_mismatch");
  }

  const account = createMainnetDeployerAccount(requireMainnetRpcUrl());
  await assertProviderIsMainnet(account.provider);
  await assertMainnetDeployerSignerReady(account);
  const payload = {
    classHash,
    constructorCalldata: [],
    salt: deploymentSalt,
    unique: true,
  } as const;
  const predictedAddress = account.deployer.buildDeployerCall(payload, account.address).addresses[0]!;
  const submit = process.env.MAINNET_VESU_ANONYMIZER_SUBMIT === "1";

  // Resume accepted transactions before deciding whether another write is needed.
  if (felt(earn.anonymizerDeclareTxHash) && earn.anonymizerDeclaredBlock === "PENDING") {
    earn.anonymizerDeclaredBlock = await acceptedBlock(account.provider, "vesu_anonymizer_declare", earn.anonymizerDeclareTxHash);
    await persistManifest(manifest);
  }
  if (felt(earn.anonymizerDeployTxHash) && earn.anonymizerDeployedBlock === "PENDING") {
    earn.anonymizerDeployedBlock = await acceptedBlock(account.provider, "vesu_anonymizer_deploy", earn.anonymizerDeployTxHash);
    await persistManifest(manifest);
  }

  let classDeclared = true;
  try { await account.provider.getClassByHash(classHash); }
  catch { classDeclared = false; }
  if (classDeclared && !felt(earn.anonymizerDeclareTxHash)) {
    throw new Error("mainnet_blocked:class_declared_but_manifest_declare_receipt_missing");
  }

  let addressLive = false;
  try {
    const liveClassHash = await account.provider.getClassHashAt(predictedAddress);
    addressLive = BigInt(liveClassHash) === BigInt(classHash);
  } catch { addressLive = false; }
  if (addressLive && !felt(earn.anonymizerDeployTxHash)) {
    throw new Error("mainnet_blocked:anonymizer_live_but_manifest_deploy_receipt_missing");
  }

  const declaration = classDeclared
    ? null
    : await account.estimateDeclareFee({ contract, casm }, { tip: 0n });
  const declareBound = declaration ? maxFeeForBounds(declaration.resourceBounds) : 0n;
  assertWithinCeiling("vesu_anonymizer_declare", declareBound, DECLARE_CEILING_STRK);

  const balance = await deployerStrkBalance(account);
  if (declaration) assertBalanceCoversBounds(balance, [declareBound]);

  if (!submit) {
    process.stdout.write(`${JSON.stringify({
      status: "ok",
      mode: "estimate_only",
      chainId: await account.provider.getChainId(),
      classHash,
      compiledClassHash,
      classDeclared,
      predictedAddress,
      balanceStrk: overallFeeStrk(balance),
      declareBoundStrk: overallFeeStrk(declareBound),
      declareCeilingStrk: DECLARE_CEILING_STRK,
      deployCeilingStrk: DEPLOY_CEILING_STRK,
      submitRequiredEnv: "MAINNET_VESU_ANONYMIZER_SUBMIT=1",
    }, null, 2)}\n`);
    return;
  }

  if (!classDeclared) {
    const declared = await account.declare(
      { contract, casm },
      { tip: 0n, resourceBounds: declaration!.resourceBounds },
    );
    if (BigInt(declared.class_hash) !== BigInt(classHash)) {
      throw new Error("mainnet_blocked:declared_vesu_anonymizer_hash_mismatch");
    }
    earn.anonymizerDeclareTxHash = declared.transaction_hash;
    earn.anonymizerDeclaredBlock = "PENDING";
    earn.verificationNotes = "RC.2 anonymizer declaration submitted; deployment and Ready smoke remain gated.";
    await persistManifest(manifest);
    await account.provider.waitForTransaction(declared.transaction_hash);
    earn.anonymizerDeclaredBlock = await acceptedBlock(account.provider, "vesu_anonymizer_declare", declared.transaction_hash);
    await persistManifest(manifest);
  }

  if (!addressLive && !felt(earn.anonymizerDeployTxHash)) {
    const deployment = await account.estimateDeployFee(payload, { tip: 0n });
    const deployBound = maxFeeForBounds(deployment.resourceBounds);
    assertWithinCeiling("vesu_anonymizer_deploy", deployBound, DEPLOY_CEILING_STRK);
    assertBalanceCoversBounds(await deployerStrkBalance(account), [deployBound]);
    const deployed = await account.deployContract(payload, {
      tip: 0n,
      resourceBounds: deployment.resourceBounds,
    });
    if (BigInt(deployed.contract_address) !== BigInt(predictedAddress)) {
      throw new Error("mainnet_blocked:vesu_anonymizer_address_mismatch");
    }
    earn.anonymizerAddress = deployed.contract_address;
    earn.anonymizerDeployTxHash = deployed.transaction_hash;
    earn.anonymizerDeployedBlock = "PENDING";
    earn.verificationNotes = "RC.2 anonymizer deployed; Ready deposit/redeem smoke still required before verified.";
    await persistManifest(manifest);
    await account.provider.waitForTransaction(deployed.transaction_hash);
    earn.anonymizerDeployedBlock = await acceptedBlock(account.provider, "vesu_anonymizer_deploy", deployed.transaction_hash);
    const liveClassHash = await account.provider.getClassHashAt(deployed.contract_address);
    if (BigInt(liveClassHash) !== BigInt(classHash)) {
      throw new Error("mainnet_blocked:live_vesu_anonymizer_class_mismatch");
    }
    await persistManifest(manifest);
  }

  await writeEvidenceScaffold(manifest);
  process.stdout.write(`${JSON.stringify({
    status: "deployed_pending_admission",
    manifestHash: manifest.manifestHash,
    classHash,
    compiledClassHash,
    address: earn.anonymizerAddress,
    declareTxHash: earn.anonymizerDeclareTxHash,
    declaredBlock: earn.anonymizerDeclaredBlock,
    deployTxHash: earn.anonymizerDeployTxHash,
    deployedBlock: earn.anonymizerDeployedBlock,
    next: ["pnpm check:vesu-anonymizer-source", "complete Ready deposit/redeem smoke", "pnpm check:vesu-earn"],
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
