#!/usr/bin/env node
/** The only machine gate allowed to admit Vesu Earn as verified. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider } from "starknet";
import { deploymentManifestSchema, rehashDeploymentManifest } from "../../packages/shared/src/index.ts";
import { verifyVesuEarnTransaction } from "../../apps/web/src/lib/vesu/verify-receipt.ts";
import { VESU_ANONYMIZER_SOURCE } from "../vesu-anonymizer-pins.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");
type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
const felt = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value);
const equalFelt = (a: unknown, b: unknown) => felt(a) && felt(b) && BigInt(a) === BigInt(b);

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; }
  catch { return null; }
}

async function main(): Promise<void> {
  const manifest = deploymentManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const expectedManifestHash = rehashDeploymentManifest(manifest);
  add("manifest-integrity", manifest.manifestHash === expectedManifestHash, `${manifest.manifestHash} / ${expectedManifestHash}`);
  add("mainnet-only", manifest.chainId === "SN_MAIN" && manifest.network === "mainnet", `${manifest.chainId}/${manifest.network}`);
  const earn = manifest.vesuEarn;
  if (!earn) throw new Error("deployments/mainnet.json has no vesuEarn row");

  const evidenceDir = path.join(root, "evidence", manifest.manifestHash, "vesu-earn");
  add("status-admissible", earn.status === "pending" || earn.status === "verified" || earn.status === "withdraw_only", earn.status);
  add("anonymizer-address-live", felt(earn.anonymizerAddress), String(earn.anonymizerAddress));
  add("anonymizer-sierra-pinned", equalFelt(earn.anonymizerClassHash, VESU_ANONYMIZER_SOURCE.expectedSierraClassHash), earn.anonymizerClassHash);
  add("anonymizer-casm-pinned", equalFelt(earn.anonymizerCompiledClassHash, VESU_ANONYMIZER_SOURCE.expectedCompiledClassHash), earn.anonymizerCompiledClassHash);
  add("declare-tx-recorded", felt(earn.anonymizerDeclareTxHash), earn.anonymizerDeclareTxHash);
  add("deploy-tx-recorded", felt(earn.anonymizerDeployTxHash), earn.anonymizerDeployTxHash);
  add("declare-block-recorded", Number.isSafeInteger(earn.anonymizerDeclaredBlock) && Number(earn.anonymizerDeclaredBlock) > 0, String(earn.anonymizerDeclaredBlock));
  add("deploy-block-recorded", Number.isSafeInteger(earn.anonymizerDeployedBlock) && Number(earn.anonymizerDeployedBlock) > 0, String(earn.anonymizerDeployedBlock));

  const parity = readJson(path.join(evidenceDir, "anonymizer-source-parity.json"));
  add("source-parity-present", parity !== null, path.relative(root, evidenceDir));
  if (parity) {
    add("source-parity-manifest-bound", parity.manifest_hash === manifest.manifestHash, String(parity.manifest_hash));
    add("source-parity-commit-bound", parity.upstream_commit === VESU_ANONYMIZER_SOURCE.commit, String(parity.upstream_commit));
    add("source-parity-sierra-bound", parity.matches_pin === true && parity.matches_manifest === true && equalFelt(parity.class_hash_from_pinned_source, earn.anonymizerClassHash), String(parity.class_hash_from_pinned_source));
    add("source-parity-casm-bound", parity.compiled_matches_pin === true && parity.compiled_matches_manifest === true && equalFelt(parity.compiled_class_hash, earn.anonymizerCompiledClassHash), String(parity.compiled_class_hash));
    add("source-parity-complete", parity.matches === true, String(parity.matches));
  }

  const smoke = readJson(path.join(evidenceDir, "smoke.json"));
  add("smoke-present", smoke !== null, path.relative(root, path.join(evidenceDir, "smoke.json")));
  let depositHash: string | null = null;
  let redeemHash: string | null = null;
  let depositAmount: bigint | null = null;
  let redeemShares: bigint | null = null;
  if (smoke) {
    add("smoke-complete", smoke.status === "complete", `status=${String(smoke.status)}`);
    add("smoke-mainnet-bound", smoke.network === "SN_MAIN" && smoke.manifestHash === manifest.manifestHash, `${String(smoke.network)}/${String(smoke.manifestHash)}`);
    add("smoke-contract-bound", equalFelt(smoke.anonymizerAddress, earn.anonymizerAddress) && equalFelt(smoke.underlyingAddress, earn.underlyingAddress) && equalFelt(smoke.vTokenAddress, earn.vTokenAddress), "anonymizer/USDC/vUSDC");
    depositHash = felt(smoke.depositTxHash) ? smoke.depositTxHash : null;
    redeemHash = felt(smoke.redeemTxHash) ? smoke.redeemTxHash : null;
    try { depositAmount = BigInt(String(smoke.depositAmount)); } catch { depositAmount = null; }
    try { redeemShares = BigInt(String(smoke.redeemShares)); } catch { redeemShares = null; }
    add("smoke-deposit", depositHash !== null && depositAmount === 100_000n, `${String(smoke.depositTxHash)}/${String(smoke.depositAmount)}`);
    add("smoke-redeem", redeemHash !== null && redeemShares !== null && redeemShares > 0n, `${String(smoke.redeemTxHash)}/${String(smoke.redeemShares)}`);
    add("private-vusdc-discovered", smoke.privateVusdcDiscovered === true, String(smoke.privateVusdcDiscovered));
    add("private-usdc-rediscovered", smoke.privateUsdcRediscovered === true, String(smoke.privateUsdcRediscovered));
    add("evidence-redacted", smoke.evidenceRedacted === true, String(smoke.evidenceRedacted));
  }

  const rpcUrl = process.env.STARKNET_MAINNET_RPC_URL;
  if (rpcUrl && felt(earn.anonymizerAddress) && depositHash && redeemHash && depositAmount && redeemShares) {
    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    const liveChain = await provider.getChainId();
    add("rpc-mainnet", equalFelt(liveChain, "0x534e5f4d41494e"), String(liveChain));
    const liveClass = await provider.getClassHashAt(earn.anonymizerAddress);
    add("deployed-class-bound", equalFelt(liveClass, earn.anonymizerClassHash), liveClass);
    const config = { privacyPoolAddress: earn.privacyPoolAddress, anonymizerAddress: earn.anonymizerAddress, underlyingAddress: earn.underlyingAddress, vTokenAddress: earn.vTokenAddress };
    const deposit = await verifyVesuEarnTransaction(provider, depositHash, { operation: "deposit", expectedInAmount: depositAmount, config });
    add("deposit-receipt-mechanism", deposit.ok, deposit.problems.join("; ") || "ok");
    const redeem = await verifyVesuEarnTransaction(provider, redeemHash, { operation: "redeem", expectedInAmount: redeemShares, config });
    add("redeem-receipt-mechanism", redeem.ok, redeem.problems.join("; ") || "ok");
  } else {
    add("live-chain-evidence", false, rpcUrl ? "deployment/smoke fields incomplete" : "STARKNET_MAINNET_RPC_URL unset");
  }

  const failures = checks.filter((item) => !item.ok);
  const admit = failures.length === 0;
  const report = { gate: "vesu-earn", status: admit ? "pass" : "fail", admitVerified: admit, manifestHash: manifest.manifestHash, checks, missing: failures.map(({ name, detail }) => `${name}: ${detail}`) };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (admit) process.stdout.write("admit verified\n");
  else { process.stderr.write(`vesu-earn-check: ${failures.length} gap(s).\n`); process.exitCode = 1; }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
