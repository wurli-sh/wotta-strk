#!/usr/bin/env node
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Check = { name: string; ok: boolean; detail: string };

function run(name: string, command: string, args: string[]): Check {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  return {
    name,
    ok: result.status === 0,
    detail: result.status === 0 ? "pass" : (result.stderr || result.stdout || "command failed").trim().slice(0, 800),
  };
}

async function exists(relative: string): Promise<Check> {
  try {
    await readFile(path.join(root, relative), "utf8");
    return { name: relative, ok: true, detail: "present" };
  } catch (error) {
    return { name: relative, ok: false, detail: error instanceof Error ? error.message : "missing" };
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(full));
    else files.push(full);
  }
  return files;
}

async function banProductionBatchSymbols(): Promise<Check> {
  const banned = /BatchHookV2|allocationRoot/;
  const roots = ["packages/shared/src", "apps/api/src", "contracts/src"].map((relative) => path.join(root, relative));
  const hits: string[] = [];
  for (const dir of roots) {
    for (const file of await walkFiles(dir)) {
      const text = await readFile(file, "utf8");
      if (banned.test(text)) hits.push(path.relative(root, file));
    }
  }
  return {
    name: "no-production-batch-hook-v2",
    ok: hits.length === 0,
    detail: hits.length ? hits.join(", ") : "pass",
  };
}

async function main(): Promise<void> {
  const checks: Check[] = [
    run("shared-tests", "pnpm", ["--filter", "@wotta/shared", "test"]),
    run("api-tests", "pnpm", ["--filter", "@wotta/api", "test"]),
    run("contracts-tests", "pnpm", ["test:contracts"]),
    run("web-tests", "pnpm", ["--filter", "@wotta/web", "test"]),
    await exists("docs/SECURITY.md"),
    await exists("docs/intent-recovery.md"),
    await exists("docs/reliability.md"),
    await exists("docs/runbooks/relayer.md"),
    await exists("docs/research/batch-hook-v2.md"),
    await exists("docs/research/confidential-source.md"),
    await exists("docs/research/batch-go-nogo.md"),
    await banProductionBatchSymbols(),
  ];
  const missing = checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
  process.stdout.write(`${JSON.stringify({ gate: "Phase 4", status: missing.length ? "fail" : "pass", checks, missing }, null, 2)}\n`);
  if (missing.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
