import { RpcProvider } from "starknet";
import type { Config } from "../config.ts";

export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export type RelayerCredentials = {
  address: string;
  privateKey: string;
  provider: RpcProvider;
  source: "relayer" | "deployer";
};

function normalizedKey(value: string | undefined): string | null {
  if (!value || !/^(?:0x)?[0-9a-f]+$/i.test(value)) return null;
  return value.startsWith("0x") ? value : `0x${value}`;
}

function contractMissing(error: unknown): boolean {
  return /contract not found/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Resolve a deployed account on the configured Starknet network. Sepolia may
 * fall back to the funded deployer account so a stale local relayer override
 * cannot strand a test burn. Mainnet remains fail-closed on the dedicated
 * relayer selected by the deployment policy.
 */
export async function resolveRelayerCredentials(
  config: Config,
  provider = new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL }),
): Promise<RelayerCredentials> {
  const candidates: Array<Omit<RelayerCredentials, "provider">> = [];
  const relayerKey = normalizedKey(
    config.env.STARKNET_RELAYER_PRIVATE_KEY ?? config.env.STARKNET_RELAYER_KEY_OR_KEYSTORE,
  );
  if (config.env.STARKNET_RELAYER_ADDRESS && relayerKey) {
    candidates.push({ address: config.env.STARKNET_RELAYER_ADDRESS, privateKey: relayerKey, source: "relayer" });
  }
  const deployerKey = normalizedKey(config.env.STARKNET_DEPLOYER_PRIVATE_KEY);
  if (
    config.env.STARKNET_DEPLOYER_ADDRESS
    && deployerKey
    && (candidates.length === 0 || config.manifest.chainId === "SN_SEPOLIA")
    && !candidates.some((candidate) => BigInt(candidate.address) === BigInt(config.env.STARKNET_DEPLOYER_ADDRESS!))
  ) {
    candidates.push({ address: config.env.STARKNET_DEPLOYER_ADDRESS, privateKey: deployerKey, source: "deployer" });
  }
  if (candidates.length === 0) throw new Error("relayer_credentials_missing");

  for (const candidate of candidates) {
    try {
      await provider.getClassHashAt(candidate.address);
      return { ...candidate, provider };
    } catch (error) {
      if (!contractMissing(error)) throw new Error("relayer_account_check_failed");
    }
  }
  throw new Error("relayer_account_not_deployed");
}

export async function relayerReadiness(config: Config): Promise<{ balance: bigint; credentials: RelayerCredentials }> {
  const credentials = await resolveRelayerCredentials(config);
  const result = await credentials.provider.callContract({
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "balanceOf",
    calldata: [credentials.address],
  });
  return {
    balance: BigInt(result[0] ?? 0) + (BigInt(result[1] ?? 0) << 128n),
    credentials,
  };
}

/** Stop every CCTP route before an irreversible burn if settlement is unavailable. */
export async function assertRelayerReadyForBurn(
  config: Config,
  readStatus: (config: Config) => Promise<{ balance: bigint }> = relayerReadiness,
): Promise<void> {
  let balance: bigint;
  try {
    balance = (await readStatus(config)).balance;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("relayer_")) throw error;
    throw new Error("relayer_readiness_check_failed");
  }
  if (balance < config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI) {
    throw new Error("relayer_strk_balance_low");
  }
}
