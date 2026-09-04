#!/usr/bin/env node
/**
 * Fail a release when the hosted Mainnet API is serving a different verified
 * manifest than the repository. This is deliberately read-only: route
 * admission and worker flags remain an explicit operator action.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const origin = cleanOrigin(valueFor("--origin") || process.env.PROD_MAINNET_API_ORIGIN || "https://wotta-api-mainnet.onrender.com");
const timeoutMs = Number(valueFor("--timeout-ms") || 30_000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  throw new Error("--timeout-ms must be an integer between 1000 and 120000");
}

const manifest = JSON.parse(readFileSync(path.join(root, "deployments", "mainnet.json"), "utf8"));
if (manifest.chainId !== "SN_MAIN" || !manifest.verified || !/^[a-f0-9]{64}$/.test(manifest.manifestHash ?? "")) {
  throw new Error("local_mainnet_manifest_not_verified");
}

const [health, routes] = await Promise.all([
  getJson("/v1/health"),
  getJson("/v1/routes"),
]);

const expectedEscrows = manifest.pools
  .filter((pool) => manifest.approvedCctpDenominations.includes(pool.denomination) && pool.verification?.status === "verified")
  .map((pool) => ({ denomination: pool.denomination, address: canonicalFelt(pool.address), classHash: canonicalFelt(pool.classHash) }))
  .sort(byDenomination);
const actualEscrows = Array.isArray(routes.escrows)
  ? routes.escrows.map((pool) => ({ denomination: String(pool.denomination), address: canonicalFelt(pool.address), classHash: canonicalFelt(pool.classHash) })).sort(byDenomination)
  : [];

const failures = [];
if (health?.ok !== true) failures.push("health.ok is not true");
if (health?.chainId !== "SN_MAIN") failures.push(`health.chainId is ${String(health?.chainId)}`);
if (health?.manifestHash !== manifest.manifestHash) failures.push("health manifestHash differs from deployments/mainnet.json");
if (routes?.chainId !== "SN_MAIN") failures.push(`routes.chainId is ${String(routes?.chainId)}`);
if (routes?.manifestHash !== manifest.manifestHash) failures.push("routes manifestHash differs from deployments/mainnet.json");
if (canonicalFelt(routes?.router) !== canonicalFelt(manifest.router.address)) failures.push("router differs from deployments/mainnet.json");
if (JSON.stringify(actualEscrows) !== JSON.stringify(expectedEscrows)) failures.push("verified escrow set differs from deployments/mainnet.json");

const payload = {
  status: failures.length ? "fail" : "pass",
  origin,
  expectedManifestHash: manifest.manifestHash,
  hostedManifestHash: health?.manifestHash ?? null,
  expectedRouter: manifest.router.address,
  hostedRouter: routes?.router ?? null,
  expectedEscrows,
  hostedEscrows: actualEscrows,
  enabledRoutes: Array.isArray(routes?.routes) ? routes.routes.filter((route) => route.enabled === true).map((route) => route.id) : [],
  workers: health?.workers ?? null,
  failures,
};
process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
if (failures.length) process.exitCode = 1;

async function getJson(endpoint) {
  let response;
  try {
    response = await fetch(`${origin}${endpoint}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
  } catch (error) {
    throw new Error(`request_failed:${endpoint}:${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new Error(`request_failed:${endpoint}:http_${response.status}`);
  try { return await response.json(); } catch { throw new Error(`request_failed:${endpoint}:invalid_json`); }
}

function valueFor(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return "";
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function cleanOrigin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("--origin must be an HTTP(S) URL");
  return parsed.origin;
}

function canonicalFelt(value) {
  try { return `0x${BigInt(String(value)).toString(16)}`; } catch { return String(value ?? ""); }
}

function byDenomination(left, right) { return Number(left.denomination) - Number(right.denomination); }
