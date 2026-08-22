#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function usage() {
  process.stderr.write(
    "usage: node packages/shared/scripts/materialize-wallet-api-evidence.mjs <smoke-session.json> [repo-root]\n",
  );
  process.exit(2);
}

function required(value, label) {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

async function main() {
  const sessionPath = process.argv[2];
  if (!sessionPath) usage();
  const root = path.resolve(process.argv[3] ?? process.cwd());
  const raw = await readFile(path.resolve(sessionPath), "utf8");
  const session = JSON.parse(raw);

  if (session.kind !== "wotta-wallet-smoke-session") {
    throw new Error("not a wotta wallet-smoke session export");
  }

  const manifestHash = required(session.manifestHash, "manifestHash");
  if (!/^[a-f0-9]{64}$/.test(manifestHash)) {
    throw new Error("manifestHash must be a 64-char lowercase hex digest");
  }

  const outDir = path.join(
    root,
    "evidence",
    manifestHash,
    "phase1-wallet-api",
  );
  await mkdir(outDir, { recursive: true });

  const summary = {
    kind: "phase1-wallet-api",
    materializedAt: new Date().toISOString(),
    manifestHash,
    chainId: session.chainId,
    usdc: session.usdc,
    readyUsdc: session.readyUsdc ?? session.usdc,
    strk20Pool: session.strk20Pool,
    strk20ClassHash: session.strk20ClassHash ?? null,
    starknetJs: session.starknetJs,
    walletApiSchema: session.walletApiSchema,
    address: session.address ?? null,
    walletId: session.walletId ?? null,
    walletVersion: session.walletVersion ?? null,
    supportedWalletApi: session.supportedWalletApi ?? [],
    eventCount: Array.isArray(session.events) ? session.events.length : 0,
    transactionHashes: (session.events ?? [])
      .map((event) => event.transactionHash)
      .filter(Boolean),
    flows: [...new Set((session.events ?? []).map((event) => event.flow))],
  };

  const sessionOut = path.join(outDir, "smoke-session.json");
  const summaryOut = path.join(outDir, "summary.json");
  const eventsOut = path.join(outDir, "events.json");

  await writeFile(sessionOut, `${JSON.stringify(session, null, 2)}\n`);
  await writeFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    eventsOut,
    `${JSON.stringify(session.events ?? [], null, 2)}\n`,
  );

  const digest = createHash("sha256").update(raw).digest("hex");
  await writeFile(
    path.join(outDir, "source-session.sha256"),
    `${digest}  ${path.basename(sessionPath)}\n`,
  );

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        outDir,
        files: [
          "smoke-session.json",
          "summary.json",
          "events.json",
          "source-session.sha256",
        ],
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
