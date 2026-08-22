import { cairo, hash, shortString, type Call, type CallDetails, type WalletAccountV6 } from "starknet";
import { Open, type PrivateTransfersInterface } from "@starkware-libs/starknet-privacy-sdk";
import type { DirectPrivacyConfig } from "./config.ts";
import { decodeUint256 } from "./flow.ts";
import { executePrivateBuilder, type ProofPhase } from "./privacy-proof.ts";

const PRIVATE_FUND = 1n;
const CLAIM = 2n;
const PRIVATE_REFUND = 3n;
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

export type PrivateFundPackage = {
  claimSecret: string;
  refundSecret: string;
  expiresAt: number;
};

export async function registerIdentity(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  return executePrivateBuilder(
    account,
    transfers,
    transfers.build({ autoSetup: true }).register(),
    onPhase,
    minimumStateBlock,
  );
}

export async function shieldUsdc(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  identityAddress: string,
  config: DirectPrivacyConfig,
  amount: bigint,
  onPhase?: (phase: ProofPhase | "funding_identity") => void,
): Promise<{ fundingTx: string; privacyTx: string }> {
  const publicBalance = await readPublicBalance(account, config.usdc);
  if (publicBalance < amount) {
    throw new Error(`Need ${amount} base units of Sepolia USDC; Ready has ${publicBalance}`);
  }
  onPhase?.("funding_identity");
  const funding = await account.execute([
    transferCall(config.usdc, identityAddress, amount),
    identityApproveCall(identityAddress, config.usdc, config.poolAddress),
  ]);
  const fundingReceipt = await account.provider.waitForTransaction(funding.transaction_hash);
  if (!fundingReceipt.isSuccess()) {
    throw new Error("Funding the privacy identity did not succeed");
  }
  const fundingBlock = fundingReceipt.block_number;
  const privacyTx = await executePrivateBuilder(
    account,
    transfers,
    transfers
      .build({ autoDiscover: { notes: "refresh" }, autoSetup: true })
      .with(config.usdc, (token) => token.deposit({ amount })),
    onPhase,
    fundingBlock,
  );
  return { fundingTx: funding.transaction_hash, privacyTx };
}

export async function privateBalance(
  transfers: PrivateTransfersInterface,
  token: string,
): Promise<bigint> {
  const result = await transfers.discoverNotes({ tokens: [BigInt(token)] });
  const notes = result.notes.get(BigInt(token)) ?? [];
  return notes.reduce((sum, note) => sum + note.amount, 0n);
}

export async function privateTransfer(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  token: string,
  recipientIdentity: string,
  amount: bigint,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  const balance = await privateBalance(transfers, token);
  if (balance < amount) {
    throw new Error(`Private balance ${balance} is below required ${amount}`);
  }
  const builder = transfers
    .build({
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
      autoSetup: true,
    })
    .with(token, (ops) => ops.transfer({ recipient: recipientIdentity, amount }))
    .surplusTo(transfers.user);
  return executePrivateBuilder(account, transfers, builder, onPhase, minimumStateBlock);
}

/**
 * Withdraw a fixed private note to Wotta and atomically record the claim in its
 * escrow. The escrow's `privacy_invoke` return is empty: it retains the USDC
 * until a later claim or expiry refund creates an open note.
 */
export async function privateFund(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  config: DirectPrivacyConfig,
  payment: PrivateFundPackage,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  const escrow = requireEscrow(config);
  const balance = await privateBalance(transfers, config.usdc);
  if (balance < escrow.denomination) {
    throw new Error(`Private balance ${balance} is below required ${escrow.denomination}`);
  }
  assertFutureExpiry(payment.expiresAt);
  const claimHash = escrowSecretHash("WOTTA_CLAIM_V1", config.chainId, escrow.address, payment.claimSecret);
  const refundHash = escrowSecretHash("WOTTA_REFUND_V1", config.chainId, escrow.address, payment.refundSecret);
  const builder = transfers
    .build({
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSelectNotes: "naive",
      autoSetup: true,
    })
    .with(config.usdc, (token) => {
      token.withdraw({ recipient: escrow.address, amount: escrow.denomination });
      token.surplusTo(transfers.user);
    })
    .invoke(() => escrowCall(escrow.address, [
      PRIVATE_FUND,
      BigInt(claimHash),
      0n,
      BigInt(refundHash),
      BigInt(payment.expiresAt),
      0n,
      0n,
      escrow.denomination,
    ]));
  return executePrivateBuilder(account, transfers, builder, onPhase, minimumStateBlock);
}

/** Release a funded payment by filling a fresh private open note. */
export async function claimPrivateFund(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  config: DirectPrivacyConfig,
  claimSecret: string,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  return settlePrivateFund(account, transfers, config, CLAIM, claimSecret, onPhase, minimumStateBlock);
}

/** Return an expired payment by filling a fresh private open note. */
export async function refundPrivateFund(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  config: DirectPrivacyConfig,
  refundSecret: string,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  return settlePrivateFund(account, transfers, config, PRIVATE_REFUND, refundSecret, onPhase, minimumStateBlock);
}

export function createPrivateFundPackage(nowSeconds = Math.floor(Date.now() / 1_000)): PrivateFundPackage {
  return {
    claimSecret: randomSecret(),
    refundSecret: randomSecret(),
    expiresAt: nowSeconds + SEVEN_DAYS_SECONDS,
  };
}

async function settlePrivateFund(
  account: WalletAccountV6,
  transfers: PrivateTransfersInterface,
  config: DirectPrivacyConfig,
  action: bigint,
  secret: string,
  onPhase?: (phase: ProofPhase) => void,
  minimumStateBlock?: number,
): Promise<string> {
  const escrow = requireEscrow(config);
  const normalizedSecret = nonZeroFelt(secret, "secret");
  const builder = transfers
    .build({
      autoDiscover: { notes: "refresh", channels: "refresh" },
      autoSetup: true,
    })
    .with(config.usdc, (token) => token.transfer({ recipient: transfers.user, amount: Open }))
    .invoke((args) => {
      const openNote = args.openNotes.find((note) => note.token === BigInt(config.usdc));
      if (!openNote) throw new Error("private claim requires one USDC open note");
      return escrowCall(escrow.address, [
        action,
        0n,
        0n,
        0n,
        0n,
        normalizedSecret,
        BigInt(openNote.noteId),
        0n,
      ]);
    });
  return executePrivateBuilder(account, transfers, builder, onPhase, minimumStateBlock);
}

function escrowCall(address: string, calldata: bigint[]): CallDetails {
  // The compatible pool always invokes the anonymizer's `privacy_invoke`
  // selector. CallDetails deliberately carries only the target and calldata.
  return { contractAddress: address, calldata };
}

function requireEscrow(config: DirectPrivacyConfig): NonNullable<DirectPrivacyConfig["escrow"]> {
  if (!config.escrow) throw new Error("Wotta direct privacy escrow is not configured");
  return config.escrow;
}

function escrowSecretHash(tag: string, chainId: "SN_MAIN" | "SN_SEPOLIA", escrow: string, secret: string): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString(tag),
    shortString.encodeShortString(chainId),
    BigInt(escrow),
    nonZeroFelt(secret, "secret"),
  ]);
}

function nonZeroFelt(value: string, label: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error(`${label} must be a hexadecimal felt`);
  const normalized = BigInt(value);
  if (normalized === 0n) throw new Error(`${label} must be non-zero`);
  return normalized;
}

function assertFutureExpiry(expiresAt: number): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) {
    throw new Error("payment expiry must be in the future");
  }
}

function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readPublicBalance(account: WalletAccountV6, token: string): Promise<bigint> {
  const result = await account.provider.callContract({
    contractAddress: token,
    entrypoint: "balance_of",
    calldata: [account.address],
  });
  return decodeUint256(result);
}

function transferCall(token: string, recipient: string, amount: bigint): Call {
  const { low, high } = cairo.uint256(amount);
  return {
    contractAddress: token,
    entrypoint: "transfer",
    calldata: [recipient, String(low), String(high)],
  };
}

function identityApproveCall(identity: string, token: string, pool: string): Call {
  const { low, high } = cairo.uint256((1n << 256n) - 1n);
  return {
    contractAddress: identity,
    entrypoint: "execute",
    calldata: [
      "1",
      token,
      hash.getSelectorFromName("approve"),
      "3",
      pool,
      String(low),
      String(high),
    ],
  };
}
