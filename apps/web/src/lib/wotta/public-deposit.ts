import { cairo, type Call, type WalletAccountV6 } from "starknet";

export type StarknetPublicDepositPlan = {
  kind: "starknet_public_deposit";
  usdc: string;
  escrowPool: string;
  claimHash: string;
  publicRefundRecipient: string;
  expiresAt: number;
};

export function isStarknetPublicDepositPlan(
  value: unknown,
): value is StarknetPublicDepositPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as StarknetPublicDepositPlan;
  return plan.kind === "starknet_public_deposit"
    && typeof plan.usdc === "string"
    && typeof plan.escrowPool === "string"
    && typeof plan.claimHash === "string"
    && typeof plan.publicRefundRecipient === "string"
    && Number.isFinite(plan.expiresAt);
}

export async function executeStarknetPublicDeposit(input: {
  account: WalletAccountV6;
  plan: StarknetPublicDepositPlan;
  amount: bigint;
  onSubmitted?: (txHash: string) => void | Promise<void>;
  onStage?: (stage: "approving" | "depositing" | "confirming") => void;
}): Promise<{ txHash: string }> {
  if (input.amount <= 0n) throw new RangeError("amount must be positive");
  input.onStage?.("approving");
  const { low, high } = cairo.uint256(input.amount);
  const approveCall: Call = {
    contractAddress: input.plan.usdc,
    entrypoint: "approve",
    calldata: [input.plan.escrowPool, String(low), String(high)],
  };
  input.onStage?.("depositing");
  const depositCall: Call = {
    contractAddress: input.plan.escrowPool,
    entrypoint: "deposit_public",
    calldata: [
      input.plan.claimHash,
      input.plan.publicRefundRecipient,
      String(input.plan.expiresAt),
    ],
  };
  const response = await input.account.execute([approveCall, depositCall]);
  await input.onSubmitted?.(response.transaction_hash);
  input.onStage?.("confirming");
  const receipt = await input.account.provider.waitForTransaction(response.transaction_hash);
  if (!receipt.isSuccess()) throw new Error("Public Starknet deposit did not succeed");
  return { txHash: response.transaction_hash };
}
