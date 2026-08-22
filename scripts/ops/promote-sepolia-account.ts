import { homedir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envPath = path.join(root, ".env");
const accountPath = path.join(homedir(), ".starknet_accounts", "starknet_open_zeppelin_accounts.json");
const accountName = "wotta-sepolia-20260820";

function upsert(env: string, name: string, value: string): string {
  const expression = new RegExp(`^${name}=.*$`, "m");
  return expression.test(env)
    ? env.replace(expression, `${name}=${value}`)
    : `${env.replace(/\n?$/, "\n")}${name}=${value}\n`;
}

async function main(): Promise<void> {
  const accounts = JSON.parse(await readFile(accountPath, "utf8")) as {
    "alpha-sepolia"?: Record<string, { address?: string; private_key?: string; deployed?: boolean }>;
  };
  const account = accounts["alpha-sepolia"]?.[accountName];
  if (!account?.deployed || !account.address || !account.private_key) throw new Error("deployed Sepolia account not found");
  let env = await readFile(envPath, "utf8");
  env = upsert(env, "STARKNET_DEPLOYER_ADDRESS", account.address);
  env = upsert(env, "STARKNET_DEPLOYER_PRIVATE_KEY", account.private_key.startsWith("0x") ? account.private_key : `0x${account.private_key}`);
  await writeFile(envPath, env, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ status: "ok", account: account.address, source: accountName }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
