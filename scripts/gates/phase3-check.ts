#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCLE_MAINNET_ROUTES, type WottaSourceRoute } from "../../packages/adapters/src/index.ts";
import { deploymentManifestSchema } from "../../packages/shared/src/index.ts";
import { verifyStarknetPrivateEvidence } from "../../apps/api/src/config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "deployments", "mainnet.json");
const HASH = /^(0x)?[0-9a-f]{64}$/i;
const FELT = /^0x[0-9a-f]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ROUTES = ["base", "solana"] as const satisfies readonly WottaSourceRoute[];

type Check = { name: string; ok: boolean; detail: string };
type Evidence = {
  version?: number;
  network?: string;
  manifestHash?: string;
  routeId?: string;
  sourceDomain?: number;
  sourceToken?: string;
  intentId?: string;
  finalityMode?: string;
  confirmed?: boolean;
  sourceBurnTxHash?: string;
  irisMessageDigest?: string;
  irisAttestationDigest?: string;
  destinationSettlementTxHash?: string;
  router?: string;
  escrowPool?: string;
  denomination?: string;
  claimHash?: string;
  expiresAt?: string;
  finalIndexedState?: string;
  decodedRouterEvent?: { intentId?: string; pool?: string; denomination?: string };
  decodedPoolEvent?: { intentId?: string; pool?: string; denomination?: string; state?: string };
};

function sameFelt(left: unknown, right: unknown): boolean {
  try { return BigInt(String(left)) === BigInt(String(right)); } catch { return false; }
}

function run(name: string, command: string, args: string[]): Check {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  return { name, ok: result.status === 0, detail: result.status === 0 ? "pass" : (result.stderr || result.stdout || "command failed").trim() };
}

async function json(target: string): Promise<unknown> {
  return JSON.parse(await readFile(target, "utf8"));
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

async function checkRouteEvidence(routeId: WottaSourceRoute, manifest: ReturnType<typeof deploymentManifestSchema.parse>): Promise<Check> {
  const base = path.join(root, "evidence", manifest.manifestHash, `cctp-${routeId}-mainnet`);
  try {
    const evidence = assertRecord(await json(path.join(base, "summary.json")), "summary") as Evidence;
    const route = CIRCLE_MAINNET_ROUTES[routeId];
    const pool = manifest.pools.find((candidate) => candidate.denomination === evidence.denomination);
    const failures: string[] = [];
    if (!route) failures.push("mainnet route registry");
    if (evidence.version !== 1 || evidence.network !== "mainnet") failures.push("version/network");
    if (evidence.manifestHash !== manifest.manifestHash) failures.push("manifestHash");
    if (evidence.routeId !== routeId || evidence.sourceDomain !== route?.domain) failures.push("route/domain");
    if (evidence.sourceToken !== route?.usdc) failures.push("sourceToken");
    if (evidence.finalityMode !== "standard") failures.push("finalityMode");
    if (evidence.confirmed !== true) failures.push("confirmed");
    if (!evidence.intentId || !UUID.test(evidence.intentId)) failures.push("intentId");
    if (!evidence.sourceBurnTxHash || evidence.sourceBurnTxHash.length < 32) failures.push("sourceBurnTxHash");
    if (!HASH.test(evidence.irisMessageDigest ?? "") || !HASH.test(evidence.irisAttestationDigest ?? "")) failures.push("Iris digests");
    if (!FELT.test(evidence.destinationSettlementTxHash ?? "")) failures.push("destinationSettlementTxHash");
    if (!sameFelt(evidence.router, manifest.router.address)) failures.push("router");
    if (!pool || !sameFelt(evidence.escrowPool, pool.address)) failures.push("escrowPool/denomination");
    if (!FELT.test(evidence.claimHash ?? "") || !Number.isFinite(Date.parse(evidence.expiresAt ?? ""))) failures.push("claimHash/expiry");
    if (evidence.finalIndexedState !== "funded") failures.push("finalIndexedState");
    for (const [label, event] of [["router", evidence.decodedRouterEvent], ["pool", evidence.decodedPoolEvent]] as const) {
      if (!event || event.intentId !== evidence.intentId || !sameFelt(event.pool, evidence.escrowPool) || event.denomination !== evidence.denomination) failures.push(`decoded ${label} event`);
    }
    if (evidence.decodedPoolEvent?.state !== "funded") failures.push("decoded pool funded state");
    return { name: `cctp-${routeId}-evidence`, ok: failures.length === 0, detail: failures.length ? `invalid ${failures.join(", ")}` : "pass" };
  } catch (error) {
    return { name: `cctp-${routeId}-evidence`, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const manifest = deploymentManifestSchema.parse(await json(manifestPath));
  const checks: Check[] = [
    { name: "manifest-schema", ok: true, detail: "deployments/mainnet.json parsed successfully" },
    run("api-tests", "pnpm", ["--filter", "@wotta/api", "test"]),
    run("adapter-tests", "pnpm", ["--filter", "@wotta/adapters", "test"]),
  ];
  for (const route of CANDIDATE_ROUTES) {
    checks.push(await checkRouteEvidence(route, manifest));
  }
  const starknetPrivateEvidence = verifyStarknetPrivateEvidence(manifest, manifestPath, manifest.manifestHash);
  checks.push({
    name: "starknet-private-evidence",
    ok: starknetPrivateEvidence,
    detail: starknetPrivateEvidence
      ? "pass"
      : `missing or invalid evidence/${manifest.manifestHash}/starknet-private-mainnet/summary.json`,
  });
  const missing = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  process.stdout.write(`${JSON.stringify({ gate: "Hard Gate 3 (mainnet)", status: missing.length ? "fail" : "pass", checks, missing }, null, 2)}\n`);
  if (missing.length) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
