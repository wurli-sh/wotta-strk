#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, Signer, constants, hash, type CompiledContract, type CompiledSierraCasm } from "starknet";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments/sepolia.json");
const sierraPath = path.join(
  root,
  "contracts/target/dev/wotta_contracts_WottaPrivacyIdentity.contract_class.json",
);
const casmPath = path.join(
  root,
  "contracts/target/dev/wotta_contracts_WottaPrivacyIdentity.compiled_contract_class.json",
);

async function main(): Promise<void> {
  const manifest = await loadManifest();
  const direct = manifest.directPrivacy;
  if (!direct || manifest.chainId !== "SN_SEPOLIA") {
    throw new Error("the direct Privacy SDK Sepolia manifest is required");
  }

  const account = createAccount();
  if (await account.provider.getChainId() !== constants.StarknetChainId.SN_SEPOLIA) {
    throw new Error("STARKNET_RPC_URL must point to Starknet Sepolia");
  }

  const sierra = JSON.parse(await readFile(sierraPath, "utf8")) as CompiledContract;
  const casm = JSON.parse(await readFile(casmPath, "utf8")) as CompiledSierraCasm;
  const classHash = hash.computeContractClassHash(sierra);

  if (process.argv.includes("--estimate")) {
    const fee = await account.estimateDeclareFee({ contract: sierra, casm });
    process.stdout.write(`${JSON.stringify({ classHash, overallFeeFri: fee.overall_fee.toString() }, null, 2)}\n`);
    return;
  }

  if (
    direct.identityClassHash === classHash &&
    process.env.WOTTA_REDECLARE_PRIVACY_IDENTITY !== "true"
  ) {
    await account.provider.getClassByHash(classHash);
    process.stdout.write(JSON.stringify({ status: "already_pinned", classHash }, null, 2) + "\n");
    return;
  }

  let declareTxHash = "ALREADY_DECLARED";
  try {
    await account.provider.getClassByHash(classHash);
  } catch {
    const declared = await account.declare({ contract: sierra, casm });
    declareTxHash = declared.transaction_hash;
    const receipt = await account.provider.waitForTransaction(declared.transaction_hash);
    if (!receipt.isSuccess()) throw new Error("privacy identity declaration reverted");
  }

  manifest.directPrivacy = {
    ...direct,
    identityClassHash: classHash,
    verificationNotes:
      "Wotta Sepolia direct privacy row: STRK20 pool, Wotta-branded privacy identity class, hosted prover, discovery service, Circle CCTP router, and fixed-denomination Wotta escrows are getter-verified.",
  };
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = rehashDeploymentManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    status: "declared_and_pinned",
    classHash,
    declareTxHash,
    manifestHash: manifest.manifestHash,
  }, null, 2) + "\n");
}

async function loadManifest(): Promise<DeploymentManifest> {
  return deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

function createAccount(): Account {
  const rpcUrl = process.env.STARKNET_RPC_URL?.trim();
  const address = process.env.STARKNET_DEPLOYER_ADDRESS?.trim();
  const rawKey = process.env.STARKNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!rpcUrl || !address || !rawKey) {
    throw new Error("STARKNET_RPC_URL, STARKNET_DEPLOYER_ADDRESS, and STARKNET_DEPLOYER_PRIVATE_KEY are required");
  }
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  return new Account({ provider, address, signer: new Signer(normalizePrivateKey(rawKey)) });
}

function normalizePrivateKey(value: string): string {
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(normalized)) return normalized;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
