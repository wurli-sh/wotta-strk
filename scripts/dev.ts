#!/usr/bin/env node
import { execSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";

/** Product web on :3000; API on :8787; indexer + relayer workers. */
const services = [
  { name: "web", args: ["--filter", "@wotta/web", "dev"] },
  { name: "api", args: ["--filter", "@wotta/api", "dev"] },
  { name: "indexer", args: ["--filter", "@wotta/api", "dev:indexer"] },
  { name: "relayer", args: ["--filter", "@wotta/api", "dev:relayer"] },
] as const;

warnStaleWalletSmoke();
assertProductWebPort();

process.stdout.write(
  "[dev] product web http://localhost:3000 · api http://127.0.0.1:8787\n",
);
process.stdout.write(
  "[dev] wallet-smoke is NOT started (optional: pnpm dev:wallet-smoke on :5173)\n",
);

const children = new Map<string, ChildProcess>();
let stopping = false;

for (const service of services) {
  const child = spawn("pnpm", service.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.set(service.name, child);
  child.once("error", (error) => {
    process.stderr.write(`[dev:${service.name}] ${error.message}\n`);
    void stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    const reason = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
    process.stderr.write(`[dev:${service.name}] stopped (${reason}); shutting down the stack\n`);
    void stop(code ?? 1);
  });
}

process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

function warnStaleWalletSmoke(): void {
  const stale3001 = portListenPids(3001);
  if (stale3001.length === 0) return;
  process.stderr.write(
    `[dev] warning: port 3001 is still in use (likely an old wallet-smoke process: pids ${stale3001.join(", ")})\n` +
      "[dev] stop it: `pkill -f 'vite.*3001'` — product UI is only on http://localhost:3000\n",
  );
}

function assertProductWebPort(): void {
  const blocked = portListenPids(3000);
  if (blocked.length === 0) return;
  process.stderr.write(
    `[dev] error: port 3000 is already in use (pids ${blocked.join(", ")})\n` +
      "[dev] stop the old dev stack first (Ctrl+C), or run: `pkill -f 'next dev --port 3000'`\n",
  );
  process.exit(1);
}

function portListenPids(port: number): number[] {
  try {
    const output = execSync(`ss -tlnp 'sport = :${port}'`, { encoding: "utf8" });
    const pids = new Set<number>();
    for (const match of output.matchAll(/pid=(\d+)/g)) {
      pids.add(Number(match[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

async function stop(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) terminate(child);
  await Promise.all([...children.values()].map(waitForExit));
  process.exit(exitCode);
}

function terminate(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      resolve();
    }, 5_000);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
