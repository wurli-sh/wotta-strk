import { RpcProvider } from "starknet";
import type { Config } from "../config.ts";

export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

export async function relayerStrkBalance(
  config: Config,
  callContract?: RpcProvider["callContract"],
): Promise<bigint> {
  const address = config.env.STARKNET_RELAYER_ADDRESS ?? config.env.STARKNET_DEPLOYER_ADDRESS;
  if (!address) throw new Error("relayer_credentials_missing");
  const request = {
    contractAddress: STRK_TOKEN_ADDRESS,
    entrypoint: "balanceOf",
    calldata: [address],
  };
  const result = callContract
    ? await callContract(request)
    : await new RpcProvider({ nodeUrl: config.env.STARKNET_RPC_URL }).callContract(request);
  return BigInt(result[0] ?? 0) + (BigInt(result[1] ?? 0) << 128n);
}

/** Stop Mainnet CCTP before the irreversible source burn if settlement funding is low. */
export async function assertRelayerReadyForBurn(
  config: Config,
  readBalance: (config: Config) => Promise<bigint> = relayerStrkBalance,
): Promise<void> {
  if (config.manifest.chainId !== "SN_MAIN") return;
  let balance: bigint;
  try {
    balance = await readBalance(config);
  } catch (error) {
    if (error instanceof Error && error.message === "relayer_credentials_missing") throw error;
    throw new Error("relayer_balance_check_failed");
  }
  if (balance < config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI) {
    throw new Error("relayer_strk_balance_low");
  }
}
