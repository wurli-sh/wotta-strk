#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const envPath = path.join(root, ".env");
const local = parseEnv(readFileSync(envPath, "utf8"));
const env = { ...local, ...process.env };
const webOrigin = cleanOrigin(env.PROD_WEB_ORIGIN || "https://wotta.vercel.app", "PROD_WEB_ORIGIN");
const testnetApiOrigin = cleanOrigin(env.PROD_TESTNET_API_ORIGIN || "https://wotta-api-testnet.onrender.com", "PROD_TESTNET_API_ORIGIN");
const mainnetApiOrigin = cleanOrigin(env.PROD_MAINNET_API_ORIGIN || "https://wotta-api-mainnet.onrender.com", "PROD_MAINNET_API_ORIGIN");
const scope = env.VERCEL_SCOPE || "wurli-shs-projects";
const project = env.VERCEL_PROJECT || "wotta";

const commonApi = required({
  NODE_ENV: "production",
  CORS_ORIGINS: webOrigin,
  SUPABASE_URL: pick("SUPABASE_URL"),
  SUPABASE_SECRET_KEY: pick("SUPABASE_SECRET_KEY"),
  STARKNET_MAINNET_RPC_URL: pick("STARKNET_MAINNET_RPC_URL"),
  RESOLVER_SIGNING_KEY: pick("RESOLVER_SIGNING_KEY"),
  IDENTITY_LOOKUP_KEY: pick("IDENTITY_LOOKUP_KEY"),
  PENDING_DELIVERY_PRIVATE_KEY: pick("PENDING_DELIVERY_PRIVATE_KEY"),
});
const testnetApi = required({
  ...commonApi,
  API_ORIGIN: testnetApiOrigin,
  STARKNET_NETWORK: "sepolia",
  STARKNET_RPC_URL: pick("STARKNET_RPC_URL"),
  DEPLOYMENT_MANIFEST_PATH: "/app/deployments/sepolia.json",
  RUN_INDEXER: "true",
  RUN_RELAYER: "true",
  CIRCLE_IRIS_BASE_URL: env.CIRCLE_IRIS_BASE_URL || "https://iris-api-sandbox.circle.com",
  CCTP_ADMITTED_ROUTES: env.CCTP_ADMITTED_ROUTES || "ethereum,arbitrum,base,solana,stellar",
  STARKNET_DEPLOYER_ADDRESS: pick("STARKNET_DEPLOYER_ADDRESS"),
  STARKNET_DEPLOYER_PRIVATE_KEY: pick("STARKNET_DEPLOYER_PRIVATE_KEY"),
  STARKNET_RELAYER_ADDRESS: env.STARKNET_RELAYER_ADDRESS || env.STARKNET_DEPLOYER_ADDRESS,
  STARKNET_RELAYER_PRIVATE_KEY: env.STARKNET_RELAYER_PRIVATE_KEY || env.STARKNET_DEPLOYER_PRIVATE_KEY,
});
const mainnetApi = {
  ...commonApi,
  API_ORIGIN: mainnetApiOrigin,
  STARKNET_NETWORK: "mainnet",
  STARKNET_RPC_URL: pick("STARKNET_MAINNET_RPC_URL"),
  DEPLOYMENT_MANIFEST_PATH: "/app/deployments/mainnet.json",
  RUN_INDEXER: "false",
  RUN_RELAYER: "false",
  CIRCLE_IRIS_BASE_URL: "https://iris-api.circle.com",
  CCTP_ADMITTED_ROUTES: "",
};

const web = required({
  NEXT_PUBLIC_APP_ORIGIN: webOrigin,
  NEXT_PUBLIC_API_URL: testnetApiOrigin,
  NEXT_PUBLIC_TESTNET_API_URL: testnetApiOrigin,
  NEXT_PUBLIC_MAINNET_API_URL: mainnetApiOrigin,
  NEXT_PUBLIC_SUPABASE_URL: pick("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pick("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: pick("NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
  NEXT_PUBLIC_STARKNET_RPC_URL: pick("NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL", "NEXT_PUBLIC_STARKNET_RPC_URL", "STARKNET_RPC_URL", "VITE_STARKNET_RPC_URL"),
  NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL: pick("NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL", "NEXT_PUBLIC_STARKNET_RPC_URL", "STARKNET_RPC_URL", "VITE_STARKNET_RPC_URL"),
  NEXT_PUBLIC_STARKNET_MAINNET_RPC_URL: pick("NEXT_PUBLIC_STARKNET_MAINNET_RPC_URL", "STARKNET_MAINNET_RPC_URL"),
  NEXT_PUBLIC_SOLANA_RPC_URL: pickOptional("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_DEVNET_RPC_URL", "VITE_SOLANA_DEVNET_RPC_URL", "SOLANA_RPC_URL") || "https://api.devnet.solana.com",
  NEXT_PUBLIC_STELLAR_RPC_URL: pickOptional("NEXT_PUBLIC_STELLAR_RPC_URL", "STELLAR_TESTNET_RPC_URL", "VITE_STELLAR_TESTNET_RPC_URL", "STELLAR_HORIZON_URL") || "https://soroban-testnet.stellar.org",
  PRIVACY_PROVER_UPSTREAM: env.PRIVACY_PROVER_UPSTREAM || "https://transaction-prover.alpha-sepolia.sw-dev.io",
  PRIVACY_DISCOVERY_UPSTREAM: env.PRIVACY_DISCOVERY_UPSTREAM || "https://discovery-service.alpha-sepolia.sw-dev.io",
  STARKNET_RPC_URL: pick("STARKNET_RPC_URL"),
  STARKNET_DEPLOYER_ADDRESS: pick("STARKNET_DEPLOYER_ADDRESS"),
  STARKNET_DEPLOYER_PRIVATE_KEY: pick("STARKNET_DEPLOYER_PRIVATE_KEY"),
});

const args = new Set(process.argv.slice(2));
if (!args.has("--vercel-only")) syncRender();
if (!args.has("--render-only")) syncVercel();

console.log(`Production origins configured: ${webOrigin}, ${testnetApiOrigin}, ${mainnetApiOrigin}`);

function syncRender() {
  const result = run("render", ["services", "--output", "json"], { capture: true });
  const services = JSON.parse(result.stdout || "[]");
  createRenderServiceIfMissing(services, "wotta-api-testnet", testnetApi);
  createRenderServiceIfMissing(services, "wotta-api-mainnet", mainnetApi);
  console.log("Render services exist. For an existing service, verify its dashboard env against docs/DEPLOYMENT.md before redeploying.");
}

function createRenderServiceIfMissing(services, name, values) {
  const found = services.some((entry) => (entry.service?.name || entry.name) === name);
  if (found) return console.log(`Render: ${name} already exists`);
  const command = [
    "services", "create", "--confirm", "--output", "json",
    "--name", name, "--type", "web_service", "--repo", "https://github.com/wurli-sh/wotta-strk",
    "--branch", "main", "--runtime", "docker", "--root-directory", ".",
    "--plan", "free", "--region", "singapore", "--health-check-path", "/v1/health",
  ];
  for (const [key, value] of Object.entries(values)) command.push("--env-var", `${key}=${value}`);
  run("render", command);
  console.log(`Render: created ${name}`);
}

function syncVercel() {
  run("vercel", ["link", "--yes", "--scope", scope, "--project", project]);
  for (const [key, value] of Object.entries(web)) {
    run("vercel", ["env", "add", key, "production", "--force", "--yes"], { input: value });
  }
  console.log(`Vercel: synced ${Object.keys(web).length} production variables to ${scope}/${project}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    input: options.input,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : options.input ? ["pipe", "inherit", "inherit"] : "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
  return result;
}

function required(values) {
  for (const [key, value] of Object.entries(values)) if (!value) throw new Error(`${key} is required for production deployment`);
  return values;
}

function pick(...names) {
  const value = pickOptional(...names);
  if (!value) throw new Error(`${names.join(" or ")} is missing from .env`);
  return value;
}

function pickOptional(...names) {
  for (const name of names) if (env[name]?.trim()) return env[name].trim();
  return "";
}

function cleanOrigin(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error(`${name} must be a public HTTPS origin`);
  return url.origin;
}

function parseEnv(source) {
  const output = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[key] = value;
  }
  return output;
}
