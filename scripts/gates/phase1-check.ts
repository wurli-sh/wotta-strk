#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploymentManifestSchema,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const network = process.argv.includes("--sepolia") ? "sepolia" : "mainnet";
const manifestPath = path.join(root, "deployments", `${network}.json`);

type GateCheck = {
  name: string;
  ok: boolean;
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

function run(label: string, command: string, args: string[]): GateCheck {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "pipe",
    encoding: "utf8",
  });
  return {
    name: label,
    ok: result.status === 0,
    detail:
      result.status === 0
        ? "pass"
        : (result.stderr || result.stdout || "command failed").trim(),
  };
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function checkWalletEvidence(manifest: DeploymentManifest): Promise<GateCheck> {
  if (!/^[a-f0-9]{64}$/.test(manifest.manifestHash)) {
    return {
      name: "wallet-smoke-artifacts",
      ok: false,
      detail: "manifestHash must be materialized before Hard Gate 1 can pass",
    };
  }
  const base = path.join(root, "evidence", manifest.manifestHash, manifest.evidence.walletSmokeFlow);
  const required = [
    "smoke-session.json",
    "summary.json",
    "events.json",
    "source-session.sha256",
  ];
  const missing: string[] = [];
  for (const entry of required) {
    if (!(await fileExists(path.join(base, entry)))) {
      missing.push(path.join("evidence", manifest.manifestHash, manifest.evidence.walletSmokeFlow, entry));
    }
  }
  if (missing.length === 0) {
    const session = JSON.parse(await readFile(path.join(base, "smoke-session.json"), "utf8")) as {
      manifestHash?: string;
      chainId?: string;
      strk20Pool?: string;
      events?: Array<{ flow?: string; status?: string; transactionHash?: string }>;
    };
    const successful = session.events?.filter((event) => event.status === "ok") ?? [];
    const successfulFlows = new Set(successful.map((event) => event.flow));
    const requiredFlows = manifest.network === "sepolia"
      ? ["connect", "register_identity", "shield_register", "balances", "direct_transfer", "private_fund", "claim_release", "private_refund"]
      : ["connect", "balances", "direct_transfer", "private_fund", "claim_release"];
    const missingFlows = requiredFlows.filter((flow) => !successfulFlows.has(flow));
    const transactionFlows = ["register_identity", "shield_register", "direct_transfer", "private_fund", "claim_release", "private_refund"]
      .filter((flow) => requiredFlows.includes(flow));
    const missingTransactions = transactionFlows.filter((flow) => !successful.some((event) => event.flow === flow && event.transactionHash));
    if (session.manifestHash !== manifest.manifestHash || session.chainId !== manifest.chainId || BigInt(session.strk20Pool ?? 0) !== BigInt(manifest.strk20Pool)) {
      missing.push("wallet evidence does not match the selected manifest/chain/pool");
    }
    if (missingFlows.length) missing.push(`successful flows: ${missingFlows.join(", ")}`);
    if (missingTransactions.length) missing.push(`transaction evidence: ${missingTransactions.join(", ")}`);
  }
  return {
    name: "wallet-smoke-artifacts",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "pass" : `missing ${missing.join(", ")}`,
  };
}

async function checkOptionalEvidenceStructure(manifest: DeploymentManifest): Promise<GateCheck> {
  const base = path.join(root, "evidence");
  if (!(await fileExists(base))) {
    return {
      name: "evidence-layout",
      ok: true,
      detail: "optional evidence root absent; skipped",
    };
  }
  const manifestDir = path.join(base, manifest.manifestHash);
  if (!(await fileExists(manifestDir))) {
    return {
      name: "evidence-layout",
      ok: true,
      detail: "optional evidence manifest directory absent; skipped",
    };
  }
  const walletDir = path.join(manifestDir, manifest.evidence.walletSmokeFlow);
  return {
    name: "evidence-layout",
    ok: await fileExists(walletDir),
    detail: (await fileExists(walletDir))
      ? "wallet smoke evidence directory present"
      : `expected ${path.relative(root, walletDir)} if evidence manifest directory exists`,
  };
}

async function main(): Promise<void> {
  const checks: GateCheck[] = [];
  const manifest = await loadManifest();
  checks.push({
    name: "manifest-schema",
    ok: true,
    detail: `deployments/${network}.json parsed successfully`,
  });

  if (!commandExists("scarb")) {
    checks.push({
      name: "contracts-build",
      ok: false,
      detail: "scarb missing from PATH",
    });
    checks.push({
      name: "contracts-test",
      ok: false,
      detail: "scarb/snforge missing from PATH",
    });
  } else {
    checks.push(run("contracts-build", "pnpm", ["contracts:build"]));
    checks.push(run("contracts-test", "pnpm", ["test:contracts"]));
  }

  checks.push(run("shared-fixture-parity", "pnpm", ["--filter", "@wotta/shared", "test"]));
  checks.push(run("wallet-smoke-tests", "pnpm", ["--filter", "@wotta/wallet-smoke", "test"]));
  checks.push(await checkWalletEvidence(manifest));
  checks.push(await checkOptionalEvidenceStructure(manifest));

  const failures = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  const payload = {
    gate: `Hard Gate 1 (${network})`,
    purpose: network === "mainnet"
      ? "mainnet_route_admission_after_deploy — does NOT block contracts:declare / deploy:mainnet"
      : "sepolia_testnet_admission — run before mainnet declare for product confidence",
    doesNotBlock: network === "mainnet" ? ["contracts:declare", "deploy:mainnet", "contracts:preflight"] : [],
    status: failures.length === 0 ? "pass" : "fail",
    checks,
    missing: failures,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (failures.length > 0) {
    process.stderr.write(
      `FAIL CLOSED (${payload.purpose})\n${failures.map((item) => `- ${item}`).join("\n")}\n`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
