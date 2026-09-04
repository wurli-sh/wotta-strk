#!/usr/bin/env node
/**
 * Sync deployments/mainnet.json pilot identities from .env:
 * deployer.address === authority.owner === STARKNET_MAINNET_DEPLOYER_ADDRESS
 * Then rehash. On-chain receipt fields stay untouched until declare/deploy.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploymentManifestSchema,
  rehashDeploymentManifest,
} from "../../packages/shared/src/index.ts";
import { syncMainnetPilotIdentities } from "./mainnet-preflight.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

async function main(): Promise<void> {
  const parsed = deploymentManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const synced = syncMainnetPilotIdentities(parsed, process.env);
  synced.generatedAt = new Date().toISOString();
  synced.manifestHash = rehashDeploymentManifest(synced);
  const final = deploymentManifestSchema.parse(synced);
  await writeFile(manifestPath, `${JSON.stringify(final, null, 2)}\n`);
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        owner: final.authority.owner,
        deployer: final.deployer.address,
        same: BigInt(final.authority.owner) === BigInt(final.deployer.address),
        manifestHash: final.manifestHash,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
