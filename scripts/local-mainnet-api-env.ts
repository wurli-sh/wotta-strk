/** Env overrides for the optional local mainnet API on :8788. */

export function isLocalMainnetApiUrl(url: string | undefined): boolean {
  const cleaned = url?.replace(/\/$/, "");
  return cleaned === "http://127.0.0.1:8788" || cleaned === "http://localhost:8788";
}

/**
 * Isolate the local mainnet API from the shared Sepolia `.env`.
 * Without this, CCTP_ADMITTED_ROUTES=ethereum,... crashes SN_MAIN boot
 * (`unsupported_admitted_route`), and workers/Iris can leak testnet settings.
 */
export function localMainnetApiEnv(opts: {
  mainnetRpcUrl: string;
  cwd: string;
}): NodeJS.ProcessEnv {
  return {
    STARKNET_NETWORK: "mainnet",
    STARKNET_RPC_URL: opts.mainnetRpcUrl,
    DEPLOYMENT_MANIFEST_PATH: `${opts.cwd}/deployments/mainnet.json`,
    PORT: "8788",
    API_ORIGIN: "http://127.0.0.1:8788",
    CCTP_ADMITTED_ROUTES: "",
    STARKNET_PRIVATE_ADMITTED: "false",
    RUN_INDEXER: "false",
    RUN_RELAYER: "false",
    CIRCLE_IRIS_BASE_URL: "https://iris-api.circle.com",
  };
}
