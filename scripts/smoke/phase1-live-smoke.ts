#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  deploymentManifestSchema,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");

type CheckResult = {
  name: string;
  status: "ok" | "skipped" | "failed";
  detail: string;
};

async function loadManifest(): Promise<DeploymentManifest> {
  const raw = await readFile(manifestPath, "utf8");
  return deploymentManifestSchema.parse(JSON.parse(raw));
}

function commandExists(command: string): boolean {
  return spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: root,
    stdio: "ignore",
  }).status === 0;
}

function runCommand(label: string, command: string, args: string[]): CheckResult {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    return {
      name: label,
      status: "failed",
      detail: (result.stderr || result.stdout || "command failed").trim(),
    };
  }
  return { name: label, status: "ok", detail: "pass" };
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function checkWalletArtifacts(manifest: DeploymentManifest): Promise<CheckResult> {
  const manifestHash = manifest.manifestHash;
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) {
    return {
      name: "wallet-smoke-artifacts",
      status: "failed",
      detail: "manifestHash is not materialized; cannot resolve evidence path",
    };
  }

  const base = path.join(root, "evidence", manifestHash, manifest.evidence.walletSmokeFlow);
  const required = [
    "smoke-session.json",
    "summary.json",
    "events.json",
    "source-session.sha256",
  ];
  const missing: string[] = [];
  for (const entry of required) {
    if (!(await fileExists(path.join(base, entry)))) {
      missing.push(path.join("evidence", manifestHash, manifest.evidence.walletSmokeFlow, entry));
    }
  }
  if (missing.length > 0) {
    return {
      name: "wallet-smoke-artifacts",
      status: "failed",
      detail: `missing ${missing.join(", ")}`,
    };
  }
  return {
    name: "wallet-smoke-artifacts",
    status: "ok",
    detail: path.relative(root, base),
  };
}

async function main(): Promise<void> {
  const results: CheckResult[] = [];
  const manifest = await loadManifest();
  results.push({
    name: "manifest-schema",
    status: "ok",
    detail: "deployments/mainnet.json parsed successfully",
  });

  if (commandExists("scarb")) {
    results.push(runCommand("contracts-build", "pnpm", ["contracts:build"]));
    results.push(runCommand("contracts-test", "pnpm", ["test:contracts"]));
  } else {
    results.push({
      name: "contracts-test",
      status: "skipped",
      detail: "scarb not installed; contract smoke skipped",
    });
  }

  results.push(await checkWalletArtifacts(manifest));

  const failed = results.filter((item) => item.status === "failed");
  const payload = {
    status: failed.length === 0 ? "ok" : "failed",
    manifestPath,
    results,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
