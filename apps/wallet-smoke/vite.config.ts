import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { Account, RpcProvider, Signer, cairo, type Call } from "starknet";
import { defineConfig, loadEnv, type Plugin } from "vite";

type SubmitPayload = {
  call?: { contractAddress?: string; entrypoint?: string; calldata?: unknown[] };
  proof?: { data?: string; output?: unknown[]; proof_facts?: unknown[] };
};

const MAX_SUBMISSION_BYTES = 16 * 1024 * 1024;
const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MAX_U256 = (1n << 256n) - 1n;
const MIN_STRK_POOL_ALLOWANCE = 100n * 10n ** 18n;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const prover = env.PRIVACY_PROVER_UPSTREAM ||
    "https://transaction-prover.alpha-sepolia.sw-dev.io";
  const discovery = env.PRIVACY_DISCOVERY_UPSTREAM ||
    "https://discovery-service.alpha-sepolia.sw-dev.io";
  const manifest = JSON.parse(
    readFileSync(new URL("../../deployments/sepolia.json", import.meta.url), "utf8"),
  ) as { directPrivacy?: { poolAddress?: string } };
  return {
    // The root .env also contains server/deployer secrets. Vite's default VITE_
    // prefix deliberately prevents those secrets from entering the browser bundle.
    envDir: "../..",
    plugins: [localPrivacySubmitter(env, manifest.directPrivacy?.poolAddress)],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/privacy/prover": {
          target: prover,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/privacy\/prover/, ""),
        },
        "/privacy/discovery": {
          target: discovery,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/privacy\/discovery/, ""),
        },
      },
    },
  };
});

function localPrivacySubmitter(
  env: Record<string, string>,
  expectedPool: string | undefined,
): Plugin {
  let account: Account | undefined;
  return {
    name: "wotta-local-privacy-submitter",
    configureServer(server) {
      server.middlewares.use("/privacy/submit", async (request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: "method not allowed" }));
          return;
        }
        try {
          if (!expectedPool) throw new Error("Sepolia direct privacy pool is not configured");
          const payload = await readJsonBody(request);
          const call = validateSubmission(payload, expectedPool);
          account ??= await createSubmitterAccount(env);
          await ensurePrivacyPoolFeeAllowance(account, expectedPool);
          // This RPC currently accepts proof/proof_facts in estimateFee but does
          // not verify the proof during simulation, so the pool observes an empty
          // tx_info.proof_facts span and reverts. Explicit bounds skip that broken
          // estimation path; the real transaction still carries and verifies both.
          const resourceBounds = await privacyResourceBounds(account);
          const tx = await account.execute(call, {
            proofFacts: payload.proof!.proof_facts as string[],
            proof: payload.proof!.data!,
            resourceBounds,
            tip: 100_000_000n,
          });
          response.statusCode = 200;
          response.end(JSON.stringify({ transactionHash: tx.transaction_hash }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    },
  };
}

async function ensurePrivacyPoolFeeAllowance(account: Account, pool: string): Promise<void> {
  const allowance = await account.provider.callContract({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "allowance",
    calldata: [account.address, pool],
  });
  const current = BigInt(allowance[0] ?? 0) + (BigInt(allowance[1] ?? 0) << 128n);
  if (current >= MIN_STRK_POOL_ALLOWANCE) return;

  const { low, high } = cairo.uint256(MAX_U256);
  const approval = await account.execute({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "approve",
    calldata: [pool, String(low), String(high)],
  });
  const receipt = await account.provider.waitForTransaction(approval.transaction_hash);
  if (!receipt.isSuccess()) {
    throw new Error(`STRK privacy-pool fee approval reverted: ${receiptRevertReason(receipt)}`);
  }
}

function receiptRevertReason(receipt: object): string {
  if ("revert_reason" in receipt && typeof receipt.revert_reason === "string") {
    return receipt.revert_reason;
  }
  return "unknown revert reason";
}

async function privacyResourceBounds(account: Account) {
  const block = await account.provider.getBlockWithTxHashes("latest") as {
    l1_gas_price?: { price_in_fri?: string };
    l1_data_gas_price?: { price_in_fri?: string };
    l2_gas_price?: { price_in_fri?: string };
  };
  const price = (value: string | undefined, label: string): bigint => {
    if (!value || BigInt(value) <= 0n) throw new Error(`latest block has no ${label} price`);
    return BigInt(value) * 3n;
  };
  return {
    // Derived from recent successful transactions against this exact pool with
    // ample headroom for registration, deposit, and transfer action variants.
    l1_gas: {
      max_amount: 0n,
      max_price_per_unit: price(block.l1_gas_price?.price_in_fri, "L1 gas"),
    },
    l1_data_gas: {
      max_amount: 4_096n,
      max_price_per_unit: price(block.l1_data_gas_price?.price_in_fri, "L1 data gas"),
    },
    l2_gas: {
      max_amount: 250_000_000n,
      max_price_per_unit: price(block.l2_gas_price?.price_in_fri, "L2 gas"),
    },
  };
}

async function createSubmitterAccount(env: Record<string, string>): Promise<Account> {
  const rpcUrl = env.STARKNET_RPC_URL?.trim();
  const address = env.STARKNET_DEPLOYER_ADDRESS?.trim();
  const privateKey = env.STARKNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!rpcUrl || !address || !privateKey) {
    throw new Error(
      "local privacy submission requires STARKNET_RPC_URL, STARKNET_DEPLOYER_ADDRESS, and STARKNET_DEPLOYER_PRIVATE_KEY",
    );
  }
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (await provider.getChainId() !== "0x534e5f5345504f4c4941") {
    throw new Error("local privacy submitter RPC is not Starknet Sepolia");
  }
  const rpcSpecVersion = await provider.getSpecVersion();
  if (!isProofAwareRpcVersion(rpcSpecVersion)) {
    throw new Error(
      `local privacy submitter requires a proof-aware Starknet RPC >= 0.10; configured endpoint reports ${rpcSpecVersion}`,
    );
  }
  return new Account({
    provider,
    address,
    signer: new Signer(normalizePrivateKey(privateKey)),
  });
}

function isProofAwareRpcVersion(value: string): boolean {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(value);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 10;
}

function validateSubmission(payload: SubmitPayload, expectedPool: string): Call {
  const call = payload.call;
  const proof = payload.proof;
  if (!call?.contractAddress || !/^0x[0-9a-f]+$/i.test(call.contractAddress)) {
    throw new Error("invalid privacy submission contract address");
  }
  if (BigInt(call.contractAddress) !== BigInt(expectedPool) || call.entrypoint !== "apply_actions") {
    throw new Error("local submitter only accepts apply_actions for the pinned Sepolia privacy pool");
  }
  if (!Array.isArray(call.calldata) ||
      call.calldata.some((value) => typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))) {
    throw new Error("invalid privacy submission calldata");
  }
  if (!proof?.data || !Array.isArray(proof.proof_facts) || proof.proof_facts.length === 0 ||
      proof.proof_facts.some((value) => typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))) {
    throw new Error("invalid or empty privacy proof");
  }
  return {
    contractAddress: call.contractAddress,
    entrypoint: call.entrypoint,
    calldata: call.calldata as string[],
  };
}

async function readJsonBody(request: IncomingMessage): Promise<SubmitPayload> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_SUBMISSION_BYTES) throw new Error("privacy proof payload is too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as SubmitPayload;
  } catch {
    throw new Error("privacy proof payload is not valid JSON");
  }
}

function normalizePrivateKey(value: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return `0x${value}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}
