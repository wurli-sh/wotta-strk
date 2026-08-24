import type { FastifyRequest } from "fastify";
import type { Config } from "./config.ts";

export type RequestChainId = "SN_MAIN" | "SN_SEPOLIA";

export function requestChainId(config: Config, request: FastifyRequest): RequestChainId {
  const mode = request.headers["x-wotta-network"];
  const configuredChainId = config.manifest.chainId as RequestChainId;
  const requestedChainId = mode === "mainnet"
    ? "SN_MAIN"
    : mode === "testnet"
      ? "SN_SEPOLIA"
      : configuredChainId;
  // The browser network picker is not an API deployment selector. A request
  // must land on the API instance whose signed manifest serves that network.
  if (requestedChainId !== configuredChainId) throw new Error("network_mode_mismatch");
  return configuredChainId;
}

export function rpcUrlForChainId(config: Config, chainId: RequestChainId): string {
  if (chainId === "SN_MAIN") {
    const url = config.env.STARKNET_MAINNET_RPC_URL?.trim();
    if (!url) throw new Error("mainnet_rpc_not_configured");
    return url;
  }
  return config.env.STARKNET_RPC_URL;
}
