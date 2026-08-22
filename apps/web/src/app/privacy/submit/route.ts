import { NextResponse } from "next/server";
import {
  Account,
  RpcProvider,
  Signer,
  cairo,
  type Call,
} from "starknet";
import sepoliaDeployment from "../../../../../../deployments/sepolia.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBMISSION_BYTES = 16 * 1024 * 1024;
const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MIN_STRK_POOL_ALLOWANCE = 100n * 10n ** 18n;
const MAX_U256 = (1n << 256n) - 1n;

type SubmitPayload = {
  call?: { contractAddress?: string; entrypoint?: string; calldata?: unknown[] };
  proof?: { data?: string; output?: unknown[]; proof_facts?: unknown[] };
};

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SUBMISSION_BYTES) {
      throw new Error("privacy proof payload is too large");
    }
    const payload = JSON.parse(raw) as SubmitPayload;
    const pool = sepoliaDeployment.directPrivacy.poolAddress;
    const call = validateSubmission(payload, pool);
    const account = await createSubmitterAccount();
    await ensurePrivacyPoolFeeAllowance(account, pool);
    const resourceBounds = await privacyResourceBounds(account);
    const transaction = await account.execute(call, {
      proofFacts: payload.proof!.proof_facts as string[],
      proof: payload.proof!.data!,
      resourceBounds,
      tip: 100_000_000n,
    });
    return NextResponse.json(
      { transactionHash: transaction.transaction_hash },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "privacy submission failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function validateSubmission(payload: SubmitPayload, expectedPool: string): Call {
  const call = payload.call;
  const proof = payload.proof;
  if (!call?.contractAddress || !/^0x[0-9a-f]+$/i.test(call.contractAddress)) {
    throw new Error("invalid privacy submission contract address");
  }
  if (BigInt(call.contractAddress) !== BigInt(expectedPool) || call.entrypoint !== "apply_actions") {
    throw new Error("submitter only accepts apply_actions for the pinned Sepolia privacy pool");
  }
  if (!Array.isArray(call.calldata) || call.calldata.some((value) =>
    typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value))) {
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

async function createSubmitterAccount(): Promise<Account> {
  const rpcUrl = process.env.STARKNET_RPC_URL?.trim();
  const address = process.env.STARKNET_DEPLOYER_ADDRESS?.trim();
  const privateKey = process.env.STARKNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!rpcUrl || !address || !privateKey) {
    throw new Error("privacy submission requires the server-side Sepolia submitter account");
  }
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (await provider.getChainId() !== "0x534e5f5345504f4c4941") {
    throw new Error("privacy submitter RPC is not Starknet Sepolia");
  }
  const version = await provider.getSpecVersion();
  if (!isProofAwareRpcVersion(version)) {
    throw new Error(`privacy submitter requires proof-aware RPC >= 0.10; found ${version}`);
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
  return Number(match[1]) > 0 || Number(match[2]) >= 10;
}

function normalizePrivateKey(value: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return `0x${value}`;
  if (/^0x[0-9a-fA-F]{1,64}$/.test(value)) return value;
  throw new Error("invalid STARKNET_DEPLOYER_PRIVATE_KEY");
}

async function ensurePrivacyPoolFeeAllowance(account: Account, pool: string) {
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
  if (!receipt.isSuccess()) throw new Error("STRK privacy-pool fee approval reverted");
}

async function privacyResourceBounds(account: Account) {
  const block = await account.provider.getBlockWithTxHashes("latest") as {
    l1_gas_price?: { price_in_fri?: string };
    l1_data_gas_price?: { price_in_fri?: string };
    l2_gas_price?: { price_in_fri?: string };
  };
  const price = (value: string | undefined, label: string) => {
    if (!value || BigInt(value) <= 0n) throw new Error(`latest block has no ${label} price`);
    return BigInt(value) * 3n;
  };
  return {
    l1_gas: { max_amount: 0n, max_price_per_unit: price(block.l1_gas_price?.price_in_fri, "L1 gas") },
    l1_data_gas: { max_amount: 4_096n, max_price_per_unit: price(block.l1_data_gas_price?.price_in_fri, "L1 data gas") },
    l2_gas: { max_amount: 250_000_000n, max_price_per_unit: price(block.l2_gas_price?.price_in_fri, "L2 gas") },
  };
}
