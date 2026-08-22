#!/usr/bin/env node
/**
 * Deploy the one-USDC Wotta escrow used by the direct Privacy SDK Sepolia
 * smoke route. It deliberately reuses the already-declared Wotta escrow
 * class; compatibility comes from constructor binding to the matching pool and
 * token, not from a separate privacy implementation.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, Signer, constants, stark } from "starknet";
import {
  deploymentManifestSchema,
  hashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "sepolia.json");
const DENOMINATION = "1000000";

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

  const classHash = process.env.WOTTA_DIRECT_ESCROW_CLASS_HASH?.trim() ||
    manifest.pools.find((pool) => pool.denomination === DENOMINATION)?.classHash;
  if (!classHash || !isFelt(classHash)) {
    throw new Error("missing a declared Wotta escrow class hash for the 1 USDC pool");
  }

  if (direct.escrow && process.env.WOTTA_REDEPLOY_DIRECT_ESCROW !== "true") {
    await verifyEscrow(account.provider, direct.escrow.address, classHash, direct.poolAddress, direct.usdc);
    process.stdout.write(JSON.stringify({ status: "already_verified", address: direct.escrow.address }, null, 2) + "\n");
    return;
  }

  const constructorCalldata = [
    direct.poolAddress,
    direct.usdc,
    "0x0", // direct route has no CCTP router
    DENOMINATION,
    constants.StarknetChainId.SN_SEPOLIA,
  ];
  const deployment = await account.deployContract({
    classHash,
    constructorCalldata,
    salt: stark.randomAddress(),
    unique: true,
  });
  const receipt = await account.provider.waitForTransaction(deployment.transaction_hash);
  if (!receipt.isSuccess()) throw new Error(`escrow deployment reverted: ${revertReason(receipt)}`);

  await verifyEscrow(account.provider, deployment.contract_address, classHash, direct.poolAddress, direct.usdc);
  const deployedBlock = receipt.block_number;
  if (typeof deployedBlock !== "number") throw new Error("deployment receipt has no block number");

  manifest.directPrivacy = {
    ...direct,
    escrow: {
      status: "verified",
      address: deployment.contract_address,
      classHash,
      denomination: DENOMINATION,
      deploymentTxHash: deployment.transaction_hash,
      deployedBlock,
      verificationNotes: "Wotta 1-USDC escrow deployed and getter-verified against the compatible PriPay Sepolia pool and native test USDC.",
    },
  };
  manifest.generatedAt = new Date().toISOString();
  manifest.manifestHash = hashDeploymentManifest({ ...manifest, manifestHash: undefined as never });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(JSON.stringify({
    status: "deployed_and_verified",
    address: deployment.contract_address,
    classHash,
    transactionHash: deployment.transaction_hash,
    deployedBlock,
  }, null, 2) + "\n");
}

async function loadManifest(): Promise<DeploymentManifest> {
  return deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

function createAccount(): Account {
  const rpcUrl = requiredEnv("STARKNET_RPC_URL");
  const address = requiredEnv("STARKNET_DEPLOYER_ADDRESS");
  const privateKey = requiredEnv("STARKNET_DEPLOYER_PRIVATE_KEY");
  return new Account({
    provider: new RpcProvider({ nodeUrl: rpcUrl }),
    address,
    signer: new Signer(normalizePrivateKey(privateKey)),
  });
}

async function verifyEscrow(
  provider: RpcProvider,
  address: string,
  expectedClassHash: string,
  expectedPrivacyPool: string,
  expectedUsdc: string,
): Promise<void> {
  const [classHash, privacyPool, usdc, router, denomination] = await Promise.all([
    provider.getClassHashAt(address),
    provider.callContract({ contractAddress: address, entrypoint: "privacy_pool", calldata: [] }),
    provider.callContract({ contractAddress: address, entrypoint: "usdc", calldata: [] }),
    provider.callContract({ contractAddress: address, entrypoint: "router", calldata: [] }),
    provider.callContract({ contractAddress: address, entrypoint: "denomination", calldata: [] }),
  ]);
  if (BigInt(classHash) !== BigInt(expectedClassHash)) throw new Error("deployed escrow class hash mismatch");
  if (BigInt(privacyPool[0] ?? 0) !== BigInt(expectedPrivacyPool)) throw new Error("deployed escrow privacy pool mismatch");
  if (BigInt(usdc[0] ?? 0) !== BigInt(expectedUsdc)) throw new Error("deployed escrow USDC mismatch");
  if (BigInt(router[0] ?? 1) !== 0n) throw new Error("direct escrow router must be zero");
  if (BigInt(denomination[0] ?? 0) !== BigInt(DENOMINATION)) throw new Error("deployed escrow denomination mismatch");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function normalizePrivateKey(value: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return `0x${value}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

function isFelt(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function revertReason(receipt: object): string {
  return "revert_reason" in receipt && typeof receipt.revert_reason === "string"
    ? receipt.revert_reason
    : "unknown revert reason";
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
