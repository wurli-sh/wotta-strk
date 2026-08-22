export type SmokeFlowId =
  | "cctp_fund"
  | "register_identity"
  | "shield_register"
  | "balances"
  | "direct_transfer"
  | "private_fund"
  | "claim_release"
  | "private_refund";

export type Felt = `0x${string}` | string;

export type NormalizedTransferAction = {
  type: "transfer";
  token: string;
  amount: string;
  recipient: string;
};

export type NormalizedInvokeAction = {
  type: "invoke";
  contract: string;
  calldata: string[];
};

export type NormalizedStrk20Action =
  | NormalizedTransferAction
  | NormalizedInvokeAction
  | {
      type: "deposit" | "withdraw";
      token: string;
      amount: string;
      recipient?: string;
    };

export type OpenNoteDeposit = {
  noteId: string;
  token: string;
  amount: string;
};

export type PreparedCallMeta = {
  contractAddress: string;
  entryPoint: string;
  calldataLength: number;
  emptyProof: boolean;
};

export type CapabilityReport = {
  walletApiVersion: string;
  walletVersion: string;
  requiredMethods: string[];
};

export type SmokeSessionEvent = {
  at: string;
  flow: SmokeFlowId | "connect" | "capabilities";
  status: "ok" | "error" | "info";
  message: string;
  actions?: NormalizedStrk20Action[];
  prepared?: PreparedCallMeta;
  noteDeposits?: OpenNoteDeposit[];
  expectedNoteDeposits?: OpenNoteDeposit[];
  balances?: Array<{ token: string; balance: string }>;
  transactionHash?: string;
  walletApiVersions?: string[];
  walletVersion?: string;
  poolAddress?: string;
  classHash?: string;
  error?: string;
};

export type SmokeSessionFile = {
  version: 1;
  kind: "wotta-wallet-smoke-session";
  createdAt: string;
  manifestHash: string;
  chainId: string;
  usdc: string;
  readyUsdc: string;
  strk20Pool: string;
  strk20ClassHash?: string;
  starknetJs: string;
  walletApiSchema: string;
  address?: string;
  walletId?: string;
  walletVersion?: string;
  supportedWalletApi?: string[];
  privacyRoute?: "wallet-api" | "direct-sdk";
  privacyIdentity?: string;
  events: SmokeSessionEvent[];
};
