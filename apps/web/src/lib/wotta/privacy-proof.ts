import { SEPOLIA_PRIVACY_IDENTITY_SNIP12_DOMAIN } from "@wotta/shared";
import {
  CallData,
  hash,
  num,
  stark,
  type TypedData,
  type WalletAccountV6,
} from "starknet";
import type {
  PrivateTransfersBuilder,
  PrivateTransfersInterface,
  ProofInvocation,
} from "@starkware-libs/starknet-privacy-sdk";

export type ProofPhase =
  | "waiting_confirmations"
  | "building_proof"
  | "signing_message"
  | "generating_proof"
  | "submitting";

const PROVING_BLOCK_MARGIN = 10;
const CONFIRMATION_POLL_MS = 2_000;
const CONFIRMATION_TIMEOUT_MS = 6 * 60_000;

export async function executePrivateBuilder(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  builder: PrivateTransfersBuilder,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  let phase: ProofPhase = "waiting_confirmations";
  try {
    const provingBlock = await waitForProofSafeBlock(
      account,
      minimumStateBlock,
      () => onPhase?.("waiting_confirmations"),
    );

    phase = "building_proof";
    onPhase?.(phase);
    const invocation = await builder.createProofInvocation();
    const invocationHash = computeInvocationHash(invocation.invocation);

    phase = "signing_message";
    onPhase?.(phase);
    const signature = stark.formatSignature(
      await account.signMessage(authTypedData(invocationHash)),
    );
    invocation.invocation.signature = signature;

    phase = "generating_proof";
    onPhase?.(phase);
    const result = await transfers.executeWithInvocation(invocation, provingBlock);

    phase = "submitting";
    onPhase?.(phase);
    const proofCall = result.callAndProof.call;
    const transactionHash = await submitProof({
      contractAddress: num.toHex(proofCall.contractAddress),
      entrypoint: proofCall.entrypoint,
      calldata: CallData.compile(proofCall.calldata ?? []).map((value) => num.toHex(value)),
    }, {
      data: result.callAndProof.proof.data,
      output: result.callAndProof.proof.output.map((value) => num.toHex(value)),
      proof_facts: result.callAndProof.proof.proofFacts.map((value) => num.toHex(value)),
    });
    const receipt = await account.provider.waitForTransaction(transactionHash);
    if (!receipt.isSuccess()) {
      const reason = "revert_reason" in receipt && typeof receipt.revert_reason === "string"
        ? receipt.revert_reason
        : "unknown revert reason";
      throw new Error(`privacy transaction reverted: ${reason}`);
    }
    return transactionHash;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${proofPhaseLabel(phase)} failed: ${message}`, { cause: error });
  }
}

type SubmissionCall = {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
};

type SubmissionProof = {
  data: string;
  output: string[];
  proof_facts: string[];
};

async function submitProof(call: SubmissionCall, proof: SubmissionProof): Promise<string> {
  const response = await fetch("/privacy/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, proof }),
  });
  const body = await response.json().catch(() => undefined) as
    | { transactionHash?: string; error?: string }
    | undefined;
  if (!response.ok || !body?.transactionHash) {
    throw new Error(body?.error ?? `local proof submitter returned HTTP ${response.status}`);
  }
  return body.transactionHash;
}

export function selectProofBlock(
  latestBlock: number,
  minimumStateBlock?: number,
  margin = PROVING_BLOCK_MARGIN,
): number | undefined {
  const provingBlock = Math.max(0, latestBlock - margin);
  return minimumStateBlock === undefined || provingBlock >= minimumStateBlock
    ? provingBlock
    : undefined;
}

async function waitForProofSafeBlock(
  account: WalletAccountV6,
  minimumStateBlock?: number,
  onWait?: () => void,
): Promise<number> {
  const startedAt = Date.now();
  for (;;) {
    const latest = await account.provider.getBlockNumber();
    const provingBlock = selectProofBlock(latest, minimumStateBlock);
    if (provingBlock !== undefined) return provingBlock;
    if (Date.now() - startedAt >= CONFIRMATION_TIMEOUT_MS) {
      throw new Error(
        `Sepolia did not advance far enough to prove state from block ${minimumStateBlock}`,
      );
    }
    onWait?.();
    await delay(CONFIRMATION_POLL_MS);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function proofPhaseLabel(phase: ProofPhase): string {
  const labels: Record<ProofPhase, string> = {
    waiting_confirmations: "Waiting for a proof-safe block",
    building_proof: "Building the private invocation",
    signing_message: "Ready privacy authorization",
    generating_proof: "Hosted proof generation",
    submitting: "Local proof submission",
  };
  return labels[phase];
}

export function computeInvocationHash(invocation: ProofInvocation): string {
  return hash.calculateInvokeTransactionHash({
    senderAddress: invocation.sender_address,
    version: invocation.version,
    compiledCalldata: invocation.calldata,
    chainId: "0x534e5f5345504f4c4941",
    nonce: invocation.nonce,
    accountDeploymentData: invocation.account_deployment_data,
    nonceDataAvailabilityMode: stark.intDAM(invocation.nonce_data_availability_mode),
    feeDataAvailabilityMode: stark.intDAM(invocation.fee_data_availability_mode),
    resourceBounds: {
      l1_gas: {
        max_amount: BigInt(invocation.resource_bounds.l1_gas.max_amount),
        max_price_per_unit: BigInt(invocation.resource_bounds.l1_gas.max_price_per_unit),
      },
      l1_data_gas: {
        max_amount: BigInt(invocation.resource_bounds.l1_data_gas.max_amount),
        max_price_per_unit: BigInt(invocation.resource_bounds.l1_data_gas.max_price_per_unit),
      },
      l2_gas: {
        max_amount: BigInt(invocation.resource_bounds.l2_gas.max_amount),
        max_price_per_unit: BigInt(invocation.resource_bounds.l2_gas.max_price_per_unit),
      },
    },
    tip: invocation.tip,
    paymasterData: invocation.paymaster_data,
    proofFacts: invocation.proof_facts ?? [],
  });
}

function authTypedData(invocationHash: string): TypedData {
  return {
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Message: [{ name: "hash", type: "felt" }],
    },
    primaryType: "Message",
    // Must match the declared Wotta privacy identity class on Sepolia.
    domain: { ...SEPOLIA_PRIVACY_IDENTITY_SNIP12_DOMAIN },
    message: { hash: invocationHash },
  };
}
