#!/usr/bin/env node
/** Verify two Ready Mainnet smoke receipts and materialize redacted gate evidence. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash, num, RpcProvider } from "starknet";
import { deploymentManifestSchema, rehashDeploymentManifest } from "../packages/shared/src/index.ts";
import { verifyVesuEarnTransaction } from "../apps/web/src/lib/vesu/verify-receipt.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "deployments", "mainnet.json");
const felt = (value: string | undefined): value is string => Boolean(value && /^0x[0-9a-f]{1,64}$/i.test(value));
const sameFelt = (left: string | undefined, right: string): boolean => {
  try { return BigInt(left ?? "") === BigInt(right); } catch { return false; }
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

async function main(): Promise<void> {
  const manifest = deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.manifestHash !== rehashDeploymentManifest(manifest)) throw new Error("deployment_manifest_hash_mismatch");
  const earn = manifest.vesuEarn;
  if (!earn || !felt(earn.anonymizerAddress)) throw new Error("vesu_anonymizer_not_deployed");
  const depositTxHash = required("VESU_SMOKE_DEPOSIT_TX_HASH");
  const redeemTxHash = required("VESU_SMOKE_REDEEM_TX_HASH");
  if (!felt(depositTxHash) || !felt(redeemTxHash)) throw new Error("invalid_vesu_smoke_tx_hash");
  if (process.env.VESU_SMOKE_PRIVATE_VUSDC_DISCOVERED !== "1") {
    throw new Error("Ready vUSDC discovery not confirmed: set VESU_SMOKE_PRIVATE_VUSDC_DISCOVERED=1");
  }
  if (process.env.VESU_SMOKE_PRIVATE_USDC_REDISCOVERED !== "1") {
    throw new Error("Ready USDC rediscovery not confirmed: set VESU_SMOKE_PRIVATE_USDC_REDISCOVERED=1");
  }

  const rpcUrl = required("STARKNET_MAINNET_RPC_URL");
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (await provider.getChainId() !== "0x534e5f4d41494e") throw new Error("wrong_network:expected_SN_MAIN");
  const liveClassHash = await provider.getClassHashAt(earn.anonymizerAddress);
  if (BigInt(liveClassHash) !== BigInt(earn.anonymizerClassHash)) throw new Error("vesu_anonymizer_live_class_mismatch");
  const config = {
    privacyPoolAddress: earn.privacyPoolAddress,
    anonymizerAddress: earn.anonymizerAddress,
    underlyingAddress: earn.underlyingAddress,
    vTokenAddress: earn.vTokenAddress,
  };
  const redeemReceipt = await provider.getTransactionReceipt(redeemTxHash);
  const withdrawalSelector = num.toHex(hash.getSelectorFromName("Withdrawal"));
  const withdrawals = ("events" in redeemReceipt ? redeemReceipt.events : []).filter((event) =>
    sameFelt(event.from_address, earn.privacyPoolAddress)
    && sameFelt(event.keys[0], withdrawalSelector)
    && sameFelt(event.keys[1], earn.anonymizerAddress)
    && sameFelt(event.keys[2], earn.vTokenAddress)
  );
  if (withdrawals.length !== 1 || !felt(withdrawals[0]?.data[3])) {
    throw new Error("cannot_infer_vesu_smoke_redeem_shares");
  }
  const redeemShares = BigInt(withdrawals[0]!.data[3]!);
  if (redeemShares <= 0n) throw new Error("invalid_vesu_smoke_redeem_shares");
  const deposit = await verifyVesuEarnTransaction(provider, depositTxHash, {
    operation: "deposit",
    expectedInAmount: 100_000n,
    config,
  });
  if (!deposit.ok) throw new Error(`vesu_deposit_receipt_rejected:${deposit.problems.join("|")}`);
  const redeem = await verifyVesuEarnTransaction(provider, redeemTxHash, {
    operation: "redeem",
    expectedInAmount: redeemShares,
    config,
  });
  if (!redeem.ok) throw new Error(`vesu_redeem_receipt_rejected:${redeem.problems.join("|")}`);

  const evidenceDir = path.join(root, "evidence", manifest.manifestHash, "vesu-earn");
  await mkdir(evidenceDir, { recursive: true });
  const smoke = {
    status: "complete",
    network: "SN_MAIN",
    manifestHash: manifest.manifestHash,
    anonymizerAddress: earn.anonymizerAddress,
    underlyingAddress: earn.underlyingAddress,
    vTokenAddress: earn.vTokenAddress,
    depositTxHash,
    redeemTxHash,
    depositAmount: "100000",
    redeemShares: redeemShares.toString(),
    privateVusdcDiscovered: true,
    privateUsdcRediscovered: true,
    evidenceRedacted: true,
    verifiedAt: new Date().toISOString(),
    depositBlock: deposit.blockNumber,
    redeemBlock: redeem.blockNumber,
    notes: "Receipt mechanism and transaction-block anonymizer residue verified from SN_MAIN; Ready discovery confirmations supplied by the smoke operator.",
  };
  await writeFile(path.join(evidenceDir, "smoke.json"), `${JSON.stringify(smoke, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(smoke, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
