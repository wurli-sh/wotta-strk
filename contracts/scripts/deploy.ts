#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, RpcProvider, Signer, stark } from "starknet";
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

function canDeploy(): { ok: boolean; reason?: string } {
  if (!process.env.STARKNET_RPC_URL?.trim()) {
    return { ok: false, reason: "missing STARKNET_RPC_URL" };
  }
  if (!process.env.STARKNET_DEPLOYER_PRIVATE_KEY?.trim()) {
    return {
      ok: false,
      reason: "missing STARKNET_DEPLOYER_PRIVATE_KEY; manifest placeholders retained",
    };
  }
  if (!process.env.STARKNET_DEPLOYER_ADDRESS?.trim()) {
    return {
      ok: false,
      reason: "missing STARKNET_DEPLOYER_ADDRESS; manifest placeholders retained",
    };
  }
  return { ok: true };
}

async function instantiateAccount(): Promise<Account> {
  const provider = new RpcProvider({
    nodeUrl: process.env.STARKNET_RPC_URL!.trim(),
  });
  const signer = new Signer(normalizePrivateKey(process.env.STARKNET_DEPLOYER_PRIVATE_KEY!));
  return new Account({
    provider,
    signer,
    address: process.env.STARKNET_DEPLOYER_ADDRESS!.trim(),
  });
}

function normalizePrivateKey(value: string): string {
  const normalized = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) return `0x${normalized}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(normalized)) return normalized;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

async function main(): Promise<void> {
  await mkdir(path.dirname(manifestPath), { recursive: true });
  const manifest = await loadManifest();
  const deployCheck = canDeploy();
  const now = new Date().toISOString();

  if (!deployCheck.ok) {
    manifest.generatedAt = now;
    manifest.router.address =
      manifest.router.address === "UNDEPLOYED"
        ? "UNDEPLOYED"
        : manifest.router.address;
    manifest.pools = manifest.pools.map((pool) => ({
      ...pool,
      address: pool.address === "UNDEPLOYED" ? "UNDEPLOYED" : pool.address,
    }));
    manifest.verificationNotes = [
      "Phase 1 deploy scaffold wrote placeholder addresses only.",
      deployCheck.reason,
    ]
      .filter(Boolean)
      .join(" ");
    manifest.manifestHash = hashDeploymentManifest({
      ...manifest,
      manifestHash: undefined as never,
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(
      JSON.stringify(
        {
          status: "ok",
          mode: "placeholder",
          reason: deployCheck.reason,
          manifestPath,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const account = await instantiateAccount();
  const salt = stark.randomAddress();
  manifest.generatedAt = now;
  manifest.deployer.address = account.address;
  manifest.verificationNotes = [
    "Live deployment key detected, but this scaffold does not submit mainnet transactions automatically.",
    `Salt reserved for later live deploy: ${salt}`,
  ].join(" ");
  manifest.manifestHash = hashDeploymentManifest({
    ...manifest,
    manifestHash: undefined as never,
  });

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        mode: "ready_for_live_deploy",
        manifestPath,
        deployer: account.address,
        reservedSalt: salt,
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
