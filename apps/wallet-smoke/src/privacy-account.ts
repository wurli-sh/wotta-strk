import {
  IndexerDiscoveryProvider,
  ProvingServiceProofProvider,
  createPrivateTransfers,
  type PrivateTransfersInterface,
} from "@starkware-libs/starknet-privacy-sdk";
import {
  SignerInterface,
  constants,
  defaultDeployer,
  type Call,
  type DeclareSignerDetails,
  type DeployAccountSignerDetails,
  type InvocationsSignerDetails,
  type Signature,
  type TypedData,
  type WalletAccountV6,
} from "starknet";
import type { DirectPrivacyConfig } from "./config.ts";

class NoOpSigner extends SignerInterface {
  async getPubKey(): Promise<string> { return "0x0"; }
  async signMessage(_data: TypedData, _address: string): Promise<Signature> { return []; }
  async signTransaction(_calls: Call[], _details: InvocationsSignerDetails): Promise<Signature> { return []; }
  async signDeployAccountTransaction(_details: DeployAccountSignerDetails): Promise<Signature> { return []; }
  async signDeclareTransaction(_details: DeclareSignerDetails): Promise<Signature> { return []; }
}

export function createPrivacyClient(
  identityAddress: string,
  viewingKey: bigint,
  config: DirectPrivacyConfig,
): PrivateTransfersInterface {
  return createPrivateTransfers({
    account: { address: identityAddress, signer: new NoOpSigner() },
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    provingProvider: new ProvingServiceProofProvider(
      config.proverPath,
      constants.StarknetChainId.SN_SEPOLIA,
      { requestTimeoutMs: 180_000, retry: { maxRetries: 3, baseDelayMs: 1_000 } },
    ),
    discoveryProvider: new IndexerDiscoveryProvider(
      config.discoveryPath,
      config.poolAddress,
    ),
    poolContractAddress: config.poolAddress,
  });
}

export async function deployPrivacyIdentity(
  account: WalletAccountV6,
  config: DirectPrivacyConfig,
): Promise<{ address: string; transactionHash: string; blockNumber: number }> {
  const salt = randomFelt();
  const built = defaultDeployer.buildDeployerCall(
    {
      classHash: config.identityClassHash,
      salt,
      unique: true,
      constructorCalldata: [account.address],
    },
    account.address,
  );
  const address = built.addresses[0];
  if (!address) throw new Error("privacy identity address calculation failed");
  const result = await account.execute(built.calls);
  const receipt = await account.provider.waitForTransaction(result.transaction_hash);
  if (!receipt.isSuccess()) throw new Error("privacy identity deployment did not succeed");
  const owner = await account.provider.callContract({
    contractAddress: address,
    entrypoint: "owner",
    calldata: [],
  });
  if (BigInt(owner[0] ?? 0) !== BigInt(account.address)) {
    throw new Error("deployed privacy identity owner does not match Ready account");
  }
  return {
    address,
    transactionHash: result.transaction_hash,
    blockNumber: receipt.block_number,
  };
}

export async function isIdentityRegistered(
  account: WalletAccountV6,
  config: DirectPrivacyConfig,
  identityAddress: string,
): Promise<boolean> {
  const result = await account.provider.callContract({
    contractAddress: config.poolAddress,
    entrypoint: "get_public_key",
    calldata: [identityAddress],
  });
  return BigInt(result[0] ?? 0) !== 0n;
}

function randomFelt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
