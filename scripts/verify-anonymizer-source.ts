/**
 * Prove the pinned RC.2 Vesu lending anonymizer source builds to the Sierra class
 * hash recorded in deployments/mainnet.json. Fail closed before any declare/deploy.
 *
 * Requires `scarb` on PATH (2.17.0) and network access to clone starknet-privacy once.
 *
 *   pnpm check:vesu-anonymizer-source
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash, num } from "starknet";
import { VESU_ANONYMIZER_SOURCE } from "./vesu-anonymizer-pins.ts";
import { deploymentManifestSchema, rehashDeploymentManifest } from "../packages/shared/src/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(root, ".vendor", "starknet-privacy-vesu");
const manifestPath = path.join(root, "deployments", "mainnet.json");

function which(bin: string): boolean {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureVendor(): void {
  if (existsSync(path.join(vendorDir, ".git"))) {
    const head = execFileSync("git", ["-C", vendorDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (head === VESU_ANONYMIZER_SOURCE.commit) return;
    execFileSync("git", ["-C", vendorDir, "fetch", "--depth", "1", "origin", VESU_ANONYMIZER_SOURCE.commit], {
      stdio: "inherit",
    });
    execFileSync("git", ["-C", vendorDir, "checkout", "--force", VESU_ANONYMIZER_SOURCE.commit], {
      stdio: "inherit",
    });
    return;
  }
  mkdirSync(path.dirname(vendorDir), { recursive: true });
  execFileSync(
    "git",
    [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      VESU_ANONYMIZER_SOURCE.repoUrl,
      vendorDir,
    ],
    { stdio: "inherit" },
  );
  execFileSync("git", ["-C", vendorDir, "fetch", "--depth", "1", "origin", VESU_ANONYMIZER_SOURCE.commit], {
    stdio: "inherit",
  });
  execFileSync("git", ["-C", vendorDir, "checkout", "--force", VESU_ANONYMIZER_SOURCE.commit], {
    stdio: "inherit",
  });
}

function onlyArtifact(kind: string, matches: string[], releaseDir: string): string {
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${kind} artifact under ${releaseDir}; got ${matches.join(", ") || "none"}`);
  }
  return path.join(releaseDir, matches[0]!);
}

function findSierraArtifact(): string {
  const releaseDir = path.join(vendorDir, "target", "release");
  if (!existsSync(releaseDir)) {
    throw new Error(`missing build output at ${releaseDir}`);
  }
  const matches = readdirSync(releaseDir).filter(
    (name) =>
      name.endsWith(".contract_class.json")
      && name.includes("VesuLendingAnonymizer")
      && !name.includes("compiled"),
  );
  return onlyArtifact("VesuLendingAnonymizer Sierra", matches, releaseDir);
}

function findCasmArtifact(): string {
  const releaseDir = path.join(vendorDir, "target", "release");
  const matches = readdirSync(releaseDir).filter(
    (name) =>
      name.endsWith(".compiled_contract_class.json")
      && name.includes("VesuLendingAnonymizer"),
  );
  return onlyArtifact("VesuLendingAnonymizer CASM", matches, releaseDir);
}

function main(): void {
  if (!which("scarb")) {
    console.error(
      "scarb not found on PATH. Install Scarb 2.17.0 (see docs/dependencies.md) and re-run.",
    );
    process.exit(1);
  }

  const scarbVersion = execFileSync("scarb", ["--version"], { encoding: "utf8" }).trim();
  if (!/\b2\.17\.0\b/.test(scarbVersion)) {
    console.error(`expected Scarb 2.17.0; got ${scarbVersion}`);
    process.exit(1);
  }

  const manifest = deploymentManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const computedManifestHash = rehashDeploymentManifest(manifest);
  if (manifest.manifestHash !== computedManifestHash) {
    console.error(`manifestHash ${manifest.manifestHash} != computed ${computedManifestHash}`);
    process.exit(1);
  }
  const manifestClassHash = manifest.vesuEarn?.anonymizerClassHash;
  const manifestCompiledClassHash = manifest.vesuEarn?.anonymizerCompiledClassHash;
  if (!manifestClassHash || !manifestCompiledClassHash || manifestCompiledClassHash === "PENDING") {
    console.error("deployments/mainnet.json Vesu anonymizer Sierra/CASM hashes missing");
    process.exit(1);
  }

  ensureVendor();
  const commit = execFileSync("git", ["-C", vendorDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (commit !== VESU_ANONYMIZER_SOURCE.commit) {
    console.error(`vendor HEAD ${commit} != pinned ${VESU_ANONYMIZER_SOURCE.commit}`);
    process.exit(1);
  }

  console.log(`building ${VESU_ANONYMIZER_SOURCE.scarbPackage} @ ${commit}…`);
  execFileSync(
    "scarb",
    ["--profile", "release", "build", "-p", VESU_ANONYMIZER_SOURCE.scarbPackage],
    { cwd: vendorDir, stdio: "inherit" },
  );

  const sierraPath = findSierraArtifact();
  const sierra = JSON.parse(readFileSync(sierraPath, "utf8"));
  const computed = num.toHex(hash.computeContractClassHash(sierra));

  const casmPath = findCasmArtifact();
  const casm = JSON.parse(readFileSync(casmPath, "utf8"));
  const compiledClassHash = num.toHex(hash.computeCompiledClassHash(casm));

  const matchesPin = BigInt(computed) === BigInt(VESU_ANONYMIZER_SOURCE.expectedSierraClassHash);
  const matchesManifest = BigInt(computed) === BigInt(manifestClassHash);
  const compiledMatchesPin = BigInt(compiledClassHash) === BigInt(VESU_ANONYMIZER_SOURCE.expectedCompiledClassHash);
  const compiledMatchesManifest = BigInt(compiledClassHash) === BigInt(manifestCompiledClassHash);

  const report = {
    verified_at: new Date().toISOString(),
    upstream_repo: VESU_ANONYMIZER_SOURCE.repoUrl,
    upstream_commit: commit,
    upstream_tag: VESU_ANONYMIZER_SOURCE.tag,
    manifest_hash: manifest.manifestHash,
    scarb_version: scarbVersion,
    scarb_package: VESU_ANONYMIZER_SOURCE.scarbPackage,
    sierra_artifact: path.relative(root, sierraPath),
    class_hash_from_pinned_source: computed,
    class_hash_expected_pin: VESU_ANONYMIZER_SOURCE.expectedSierraClassHash,
    class_hash_in_mainnet_manifest: manifestClassHash,
    compiled_class_hash: compiledClassHash,
    compiled_class_hash_expected_pin: VESU_ANONYMIZER_SOURCE.expectedCompiledClassHash,
    compiled_class_hash_in_mainnet_manifest: manifestCompiledClassHash,
    matches_pin: matchesPin,
    matches_manifest: matchesManifest,
    compiled_matches_pin: compiledMatchesPin,
    compiled_matches_manifest: compiledMatchesManifest,
    matches: matchesPin && matchesManifest && compiledMatchesPin && compiledMatchesManifest,
  };

  const evidenceDir = path.join(
    root,
    "evidence",
    manifest.manifestHash,
    "vesu-earn",
  );
  mkdirSync(evidenceDir, { recursive: true });
  const outPath = path.join(evidenceDir, "anonymizer-source-parity.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${path.relative(root, outPath)}`);

  if (!report.matches) {
    console.error(
      "\nPinned Vesu anonymizer source does not match the expected / manifest Sierra and CASM hashes. Do not declare.",
    );
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
