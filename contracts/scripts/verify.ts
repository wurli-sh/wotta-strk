#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploymentManifestSchema,
  hashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

async function loadManifest(): Promise<DeploymentManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return deploymentManifestSchema.parse(JSON.parse(raw));
}

function isLiveFelt(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

async function main(): Promise<void> {
  const manifest = await loadManifest();
  const checkedAt = new Date().toISOString();

  const routerReady =
    isLiveFelt(manifest.router.classHash) && isLiveFelt(manifest.router.address);
  const poolsReady = manifest.pools.every(
    (pool) => isLiveFelt(pool.classHash) && isLiveFelt(pool.address),
  );

  const status =
    routerReady && poolsReady && manifest.verified ? "verified" : "pending";
  const note =
    status === "verified"
      ? "Manifest is marked verified and every router/pool has live-looking addresses and class hashes."
      : "Verification remains pending until mainnet declaration, deployment, and evidence are recorded.";

  manifest.router.verification = {
    status,
    checkedAt,
    notes: note,
  };
  manifest.pools = manifest.pools.map((pool) => ({
    ...pool,
    verification: {
      status: isLiveFelt(pool.classHash) && isLiveFelt(pool.address) ? status : "pending",
      checkedAt,
      notes: note,
    },
  }));
  manifest.verificationNotes = note;
  manifest.manifestHash = hashDeploymentManifest({
    ...manifest,
    manifestHash: undefined as never,
  });

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        verificationStatus: status,
        manifestPath,
        checkedAt,
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
