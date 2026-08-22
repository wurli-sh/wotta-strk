import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ec } from "starknet";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(root, ".env");
const keys = ["AUDITOR", "SCREENER"] as const;

function parsePrivateKey(value: string): Uint8Array {
  const hex = value.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("invalid private key format");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function upsert(env: string, name: string, value: string): string {
  const expression = new RegExp(`^${name}=.*$`, "m");
  return expression.test(env)
    ? env.replace(expression, `${name}=${value}`)
    : `${env.replace(/\n?$/, "\n")}${name}=${value}\n`;
}

async function main(): Promise<void> {
  let env = await readFile(envPath, "utf8");
  const publicKeys: Record<string, string> = {};
  for (const role of keys) {
    const privateName = `WOTTA_SEPOLIA_${role}_PRIVATE_KEY`;
    const publicName = `WOTTA_SEPOLIA_${role}_PUBLIC_KEY`;
    const existing = env.match(new RegExp(`^${privateName}=(.+)$`, "m"))?.[1]?.trim();
    const privateKey = existing ? parsePrivateKey(existing) : ec.starkCurve.utils.randomPrivateKey();
    if (!ec.starkCurve.utils.isValidPrivateKey(privateKey)) throw new Error(`invalid ${privateName}`);
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    env = upsert(env, privateName, `0x${Buffer.from(privateKey).toString("hex")}`);
    env = upsert(env, publicName, publicKey);
    publicKeys[role.toLowerCase()] = publicKey;
  }
  env = upsert(env, "WOTTA_SEPOLIA_PROOF_VALIDITY_BLOCKS", "450");
  await writeFile(envPath, env, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: "ok", publicKeys, proofValidityBlocks: 450 }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
