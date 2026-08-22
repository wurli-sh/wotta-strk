#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, Signer, constants, hash, stark, type CompiledContract, type CompiledSierraCasm } from "starknet";
import { deploymentManifestSchema, hashDeploymentManifest, type DeploymentManifest } from "../../packages/shared/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments/sepolia.json");
const routerSierraPath = path.join(root, "contracts/target/dev/wotta_contracts_WottaCctpRouter.contract_class.json");
const routerCasmPath = path.join(root, "contracts/target/dev/wotta_contracts_WottaCctpRouter.compiled_contract_class.json");
const MESSAGE_TRANSMITTER = "0x04db7926C64f1f32a840F3Fa95cB551f3801a3600Bae87aF87807A54DCE12Fe8";
const TOKEN_MESSENGER = "0x04bDdE1E09a4B09a2F95d893D94a967b7717eB85A3f6dEcA8c080Ee01fBc3370";

async function main() {
  const manifest = await loadManifest();
  const direct = manifest.directPrivacy;
  if (!direct?.escrow || direct.status !== "verified") throw new Error("verified direct privacy deployment required");
  const account = createAccount();
  if (await account.provider.getChainId() !== constants.StarknetChainId.SN_SEPOLIA) throw new Error("STARKNET_RPC_URL must point to Starknet Sepolia");

  const sierra = JSON.parse(await readFile(routerSierraPath, "utf8")) as CompiledContract;
  const casm = JSON.parse(await readFile(routerCasmPath, "utf8")) as CompiledSierraCasm;
  const computedClassHash = hash.computeContractClassHash(sierra);
  if (process.argv.includes("--estimate")) {
    const fee = await account.estimateDeclareFee({ contract: sierra, casm });
    process.stdout.write(`${JSON.stringify({ classHash: computedClassHash, overallFeeFri: fee.overall_fee.toString() }, null, 2)}\n`);
    return;
  }
  let declareTxHash = "ALREADY_DECLARED";
  try {
    await account.provider.getClassByHash(computedClassHash);
  } catch {
    const declared = await account.declare({ contract: sierra, casm });
    declareTxHash = declared.transaction_hash;
    const receipt = await account.provider.waitForTransaction(declared.transaction_hash);
    if (!receipt.isSuccess()) throw new Error("router declaration reverted");
  }

  const routerDeployment = await account.deployContract({
    classHash: computedClassHash,
    constructorCalldata: [MESSAGE_TRANSMITTER, direct.usdc, TOKEN_MESSENGER],
    salt: stark.randomAddress(), unique: true,
  });
  const routerReceipt = await account.provider.waitForTransaction(routerDeployment.transaction_hash);
  if (!routerReceipt.isSuccess() || typeof routerReceipt.block_number !== "number") throw new Error("router deployment reverted");

  const escrowClassHash = direct.escrow.classHash;
  const pools: DeploymentManifest["pools"] = [];
  for (const existing of manifest.pools) {
    const constructorCalldata = [direct.poolAddress, direct.usdc, routerDeployment.contract_address, existing.denomination, constants.StarknetChainId.SN_SEPOLIA];
    const deployed = await account.deployContract({ classHash: escrowClassHash, constructorCalldata, salt: stark.randomAddress(), unique: true });
    const receipt = await account.provider.waitForTransaction(deployed.transaction_hash);
    if (!receipt.isSuccess() || typeof receipt.block_number !== "number") throw new Error(`escrow ${existing.denomination} deployment reverted`);
    await verifyPool(account.provider, deployed.contract_address, direct.poolAddress, direct.usdc, routerDeployment.contract_address, existing.denomination);
    pools.push({
      ...existing,
      classHash: escrowClassHash,
      address: deployed.contract_address,
      deployTxHash: deployed.transaction_hash,
      deployedBlock: receipt.block_number,
      constructorCalldata,
      verification: { status: "verified", checkedAt: new Date().toISOString(), notes: "Getter-verified against Circle Sepolia USDC, the compatible private pool, and Wotta CCTP router." },
    });
  }
  await verifyRouter(account.provider, routerDeployment.contract_address, computedClassHash, direct.usdc);
  manifest.usdc = direct.usdc;
  manifest.strk20Pool = direct.poolAddress;
  manifest.strk20ClassHash = direct.poolClassHash;
  manifest.router = {
    classHash: computedClassHash,
    address: routerDeployment.contract_address,
    declareTxHash,
    deployTxHash: routerDeployment.transaction_hash,
    deployedBlock: routerReceipt.block_number,
    constructorCalldata: [MESSAGE_TRANSMITTER, direct.usdc, TOKEN_MESSENGER],
    verification: { status: "verified", checkedAt: new Date().toISOString(), notes: "Getter-verified Circle CCTP V2 MessageTransmitter, TokenMessengerMinter, and Starknet Sepolia USDC bindings." },
  };
  manifest.pools = pools;
  manifest.generatedAt = new Date().toISOString();
  manifest.verificationNotes = "Direct privacy and destination CCTP contracts are deployed on Sepolia. Source-chain live burns remain route-specific smoke evidence.";
  manifest.manifestHash = hashDeploymentManifest({ ...manifest, manifestHash: undefined as never });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: "deployed_and_verified", router: manifest.router, pools: manifest.pools }, null, 2)}\n`);
}

async function verifyRouter(provider: RpcProvider, address: string, classHash: string, usdc: string) {
  const [actualClass, transmitter, messenger, token] = await Promise.all([
    provider.getClassHashAt(address),
    provider.callContract({ contractAddress: address, entrypoint: "message_transmitter", calldata: [] }),
    provider.callContract({ contractAddress: address, entrypoint: "token_messenger", calldata: [] }),
    provider.callContract({ contractAddress: address, entrypoint: "usdc", calldata: [] }),
  ]);
  if (BigInt(actualClass) !== BigInt(classHash) || BigInt(transmitter[0] ?? 0) !== BigInt(MESSAGE_TRANSMITTER) || BigInt(messenger[0] ?? 0) !== BigInt(TOKEN_MESSENGER) || BigInt(token[0] ?? 0) !== BigInt(usdc)) throw new Error("router verification mismatch");
}

async function verifyPool(provider: RpcProvider, address: string, privacy: string, usdc: string, router: string, denomination: string) {
  const values = await Promise.all(["privacy_pool", "usdc", "router", "denomination"].map((entrypoint) => provider.callContract({ contractAddress: address, entrypoint, calldata: [] })));
  const expected = [privacy, usdc, router, denomination];
  values.forEach((value, index) => { if (BigInt(value[0] ?? 0) !== BigInt(expected[index]!)) throw new Error(`pool ${entrypointName(index)} mismatch`); });
}
const entrypointName = (index: number) => ["privacy", "usdc", "router", "denomination"][index];

async function loadManifest(): Promise<DeploymentManifest> { return deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))); }
function createAccount() {
  const rpc = required("STARKNET_RPC_URL"), address = required("STARKNET_DEPLOYER_ADDRESS"), key = required("STARKNET_DEPLOYER_PRIVATE_KEY");
  return new Account({ provider: new RpcProvider({ nodeUrl: rpc }), address, signer: new Signer(normalizePrivateKey(key)) });
}
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`missing ${name}`); return value; }
function normalizePrivateKey(value: string) {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return `0x${value}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === "object"
    ? Object.fromEntries(Object.entries(error).filter(([key]) => key !== "request" && key !== "params"))
    : {};
  process.stderr.write(`${JSON.stringify({ message: message.slice(-4_000), details }, null, 2)}\n`);
  process.exit(1);
});
