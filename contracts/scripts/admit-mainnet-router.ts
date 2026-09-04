#!/usr/bin/env node
/**
 * Owner ops: admit Base (6) + Solana (5) source domains and unpause the Mainnet router.
 * Required for real CCTP mint/settle after FE burns — API admission alone is not enough.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProvider, CallData } from "starknet";
import { deploymentManifestSchema } from "../../packages/shared/src/index.ts";
import { STARKNET_MAINNET_CHAIN_ID } from "./mainnet-constants.ts";
import {
  assertMainnetDeployerSignerReady,
  assertProviderIsMainnet,
  createMainnetDeployerAccount,
  requireMainnetRpcUrl,
} from "./mainnet-rpc.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

const SOLANA_DOMAIN = 5;
const BASE_DOMAIN = 6;

async function callFelt(
  provider: RpcProvider,
  address: string,
  entrypoint: string,
  calldata: string[] = [],
): Promise<string> {
  const result = await provider.callContract({ contractAddress: address, entrypoint, calldata });
  return result[0] ?? "0x0";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rpcUrl = requireMainnetRpcUrl();
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  await assertProviderIsMainnet(provider);

  const manifest = deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const router = manifest.router.address;
  if (!/^0x[0-9a-f]+$/i.test(router) || router === "UNDEPLOYED") {
    throw new Error("mainnet_blocked:router_undeployed");
  }

  const paused = BigInt(await callFelt(provider, router, "paused")) !== 0n;
  const baseAdmitted =
    BigInt(await callFelt(provider, router, "is_source_domain_admitted", [String(BASE_DOMAIN)])) !== 0n;
  const solanaAdmitted =
    BigInt(await callFelt(provider, router, "is_source_domain_admitted", [String(SOLANA_DOMAIN)])) !== 0n;

  console.log(JSON.stringify({
    chainId: STARKNET_MAINNET_CHAIN_ID,
    router,
    paused,
    baseAdmitted,
    solanaAdmitted,
    dryRun,
  }, null, 2));

  if (!paused && baseAdmitted && solanaAdmitted) {
    console.log("already_open: nothing to do");
    return;
  }

  if (dryRun) {
    console.log("dry_run: would admit domains 5+6 and unpause if needed");
    return;
  }

  const account = createMainnetDeployerAccount(rpcUrl);
  await assertMainnetDeployerSignerReady(account);

  const calls = [];
  if (!solanaAdmitted) {
    calls.push({
      contractAddress: router,
      entrypoint: "set_source_domain_admitted",
      calldata: CallData.compile([SOLANA_DOMAIN, true]),
    });
  }
  if (!baseAdmitted) {
    calls.push({
      contractAddress: router,
      entrypoint: "set_source_domain_admitted",
      calldata: CallData.compile([BASE_DOMAIN, true]),
    });
  }
  if (paused) {
    calls.push({
      contractAddress: router,
      entrypoint: "unpause",
      calldata: [],
    });
  }

  const result = await account.execute(calls);
  console.log(JSON.stringify({
    txHash: result.transaction_hash,
    calls: calls.map((c) => c.entrypoint),
  }, null, 2));
  await provider.waitForTransaction(result.transaction_hash);

  const after = {
    paused: BigInt(await callFelt(provider, router, "paused")) !== 0n,
    baseAdmitted:
      BigInt(await callFelt(provider, router, "is_source_domain_admitted", [String(BASE_DOMAIN)])) !== 0n,
    solanaAdmitted:
      BigInt(await callFelt(provider, router, "is_source_domain_admitted", [String(SOLANA_DOMAIN)])) !== 0n,
  };
  console.log(JSON.stringify({ after }, null, 2));
  if (after.paused || !after.baseAdmitted || !after.solanaAdmitted) {
    throw new Error("mainnet_blocked:router_still_closed_after_admit");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
