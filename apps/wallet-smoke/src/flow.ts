import {
  walletV6,
  type STRK20_ACTION,
  type WalletAccountV6,
} from "starknet";
import {
  buildClaimReleaseActions,
  buildDirectTransferActions,
  buildPrivateFundActions,
  buildShieldRegisterActions,
} from "./actions.ts";
import {
  assertWalletCapabilities,
  REQUIRED_WALLET_API,
} from "./capabilities.ts";
import { assertHelperConfigured, type SmokeConfig } from "./config.ts";
import {
  decodeOpenNoteDeposits,
  decodeOpenNoteDepositsFromReceipt,
  expectedNoteDepositsForFlow,
  normalizeActions,
  normalizePreparedCall,
} from "./decode.ts";
import type {
  CapabilityReport,
  NormalizedStrk20Action,
  OpenNoteDeposit,
  PreparedCallMeta,
  SmokeFlowId,
} from "./types.ts";

export type ConnectedWallet = {
  account: WalletAccountV6;
  address: string;
  walletId: string;
  walletVersion: string;
  supportedWalletApi: string[];
  capabilities: CapabilityReport;
};

export type PreparedInvoke = {
  actions: NormalizedStrk20Action[];
  prepared: PreparedCallMeta;
  expectedNoteDeposits: OpenNoteDeposit[];
};

export type InvokeResult = {
  transactionHash: string;
  observedNoteDeposits: OpenNoteDeposit[];
};

type WalletLike = {
  id?: string;
  name?: string;
  version?: string;
  features: Record<string, unknown>;
};

export async function detectCapabilities(
  account: WalletAccountV6,
  wallet: WalletLike,
): Promise<{
  supportedWalletApi: string[];
  capabilities: CapabilityReport;
  walletVersion: string;
}> {
  const supportedWalletApi = (
    await walletV6.supportedWalletApi(wallet as never)
  ).map(String);
  const feature = wallet.features["starknet:walletApi"] as
    | { walletVersion?: string }
    | undefined;
  const walletVersion =
    feature?.walletVersion ?? wallet.version ?? wallet.id ?? "unknown";
  const capabilities = assertWalletCapabilities({
    supportedWalletApi,
    walletVersion,
    featureNames: Object.keys(wallet.features),
  });
  if (!supportedWalletApi.includes(REQUIRED_WALLET_API)) {
    throw new Error("fail closed: Wallet API 0.10.3 unavailable");
  }
  if (!account.address) {
    throw new Error("WalletAccountV6 address missing after connect");
  }
  return { supportedWalletApi, capabilities, walletVersion };
}

export async function readBalances(
  account: WalletAccountV6,
  config: SmokeConfig,
): Promise<Array<{ token: string; balance: string }>> {
  const tokens = [...new Set([config.readyUsdc, config.usdc])];
  const entries = await account.strk20Balances(tokens);
  return entries.map((entry) => ({
    token: String(entry.token),
    balance: String(entry.balance),
  }));
}

export function decodeUint256(values: string[]): bigint {
  const [low, high] = values;
  if (low === undefined || high === undefined) {
    throw new Error("ERC-20 balance_of returned an invalid u256");
  }
  return BigInt(low) + (BigInt(high) << 128n);
}

export async function readPublicBalance(
  account: WalletAccountV6,
  token: string,
  owner: string,
): Promise<bigint> {
  const result = await account.provider.callContract(
    {
      contractAddress: token,
      entrypoint: "balance_of",
      calldata: [owner],
    },
    "latest",
  );
  return decodeUint256(result);
}

export async function prepareGatedInvoke(
  account: WalletAccountV6,
  flow: SmokeFlowId,
  actions: NormalizedStrk20Action[],
  expected: OpenNoteDeposit[],
): Promise<PreparedInvoke> {
  if (flow === "balances") {
    throw new Error("balances flow does not prepare invokes");
  }
  const preparedRaw = await account.strk20PrepareInvoke(
    actions as STRK20_ACTION[],
    true,
  );
  const prepared = normalizePreparedCall(preparedRaw);
  if (!prepared.emptyProof) {
    throw new Error(
      "fail closed: strk20PrepareInvoke(simulate=true) must return an empty proof preview",
    );
  }
  return {
    actions: normalizeActions(actions),
    prepared,
    expectedNoteDeposits: expected,
  };
}

export async function submitStrk20Invoke(
  account: WalletAccountV6,
  actions: NormalizedStrk20Action[],
  observedRaw?: unknown,
): Promise<InvokeResult> {
  const result = await account.strk20InvokeTransaction(
    actions as STRK20_ACTION[],
  );
  let observedNoteDeposits = decodeOpenNoteDeposits(observedRaw ?? []);
  try {
    const receipt = await account.provider.getTransactionReceipt(
      result.transaction_hash,
    );
    const fromReceipt = decodeOpenNoteDepositsFromReceipt(receipt);
    if (fromReceipt.length > 0) {
      observedNoteDeposits = fromReceipt;
    }
  } catch {
    // Best effort only: submit should still succeed even if the receipt is not
    // indexed yet or the note-deposit shape is not decodable from raw events.
  }
  return {
    transactionHash: String(result.transaction_hash),
    observedNoteDeposits,
  };
}

export async function submitPreparedInvoke(
  account: WalletAccountV6,
  prepared: PreparedInvoke,
  observedRaw?: unknown,
): Promise<InvokeResult> {
  return submitStrk20Invoke(account, prepared.actions, observedRaw);
}

export function actionsForFlow(
  flow: Exclude<SmokeFlowId, "balances">,
  config: SmokeConfig,
  input: {
    recipient: string;
    commitmentHash: string;
    secret: string;
  },
): { actions: NormalizedStrk20Action[]; expected: OpenNoteDeposit[] } {
  if (flow === "shield_register") {
    return {
      actions: buildShieldRegisterActions({
        token: config.readyUsdc,
        amount: config.smokeAmount,
      }),
      expected: [],
    };
  }

  if (flow === "direct_transfer") {
    const actions = buildDirectTransferActions({
      token: config.readyUsdc,
      amount: config.smokeAmount,
      recipient: input.recipient,
    });
    return {
      actions,
      expected: expectedNoteDepositsForFlow(flow, {
        token: config.readyUsdc,
        amount: config.smokeAmount,
      }),
    };
  }

  const helper = assertHelperConfigured(config);
  if (flow === "private_fund") {
    const actions = buildPrivateFundActions({
      helper,
      token: config.usdc,
      amount: config.smokeAmount,
      commitmentHash: input.commitmentHash,
    });
    return {
      actions,
      expected: expectedNoteDepositsForFlow(flow, {
        token: config.usdc,
        amount: config.smokeAmount,
      }),
    };
  }

  const actions = buildClaimReleaseActions({
    helper,
    token: config.usdc,
    recipient: input.recipient,
    secret: input.secret,
  });
  return {
    actions,
    expected: expectedNoteDepositsForFlow(flow, {
      token: config.usdc,
      amount: config.smokeAmount,
    }),
  };
}
