/** Env overrides for the optional local mainnet API on :8788. */

export function isLocalMainnetApiUrl(url: string | undefined): boolean {
  const cleaned = url?.replace(/\/$/, "");
  return cleaned === "http://127.0.0.1:8788" || cleaned === "http://localhost:8788";
}

/**
 * Isolate the local mainnet API from the shared Sepolia `.env`.
 * Without this, CCTP_ADMITTED_ROUTES=ethereum,... crashes SN_MAIN boot
 * (`unsupported_admitted_route`), and workers/Iris can leak testnet settings.
 *
 * When `MAINNET_FORCE_ADMIT=true` (local unlock without phase evidence files),
 * admit Base + Solana + Starknet-private and start indexer/relayer in-process.
 */
export function localMainnetApiEnv(opts: {
  mainnetRpcUrl: string;
  cwd: string;
  forceAdmit?: boolean;
}): NodeJS.ProcessEnv {
  const forceAdmit = opts.forceAdmit === true;
  return {
    STARKNET_NETWORK: "mainnet",
    STARKNET_RPC_URL: opts.mainnetRpcUrl,
    DEPLOYMENT_MANIFEST_PATH: `${opts.cwd}/deployments/mainnet.json`,
    PORT: "8788",
    API_ORIGIN: "http://127.0.0.1:8788",
    MAINNET_FORCE_ADMIT: forceAdmit ? "true" : "false",
    CCTP_ADMITTED_ROUTES: forceAdmit ? "base,solana" : "",
    STARKNET_PRIVATE_ADMITTED: forceAdmit ? "true" : "false",
    RUN_INDEXER: forceAdmit ? "true" : "false",
    RUN_RELAYER: forceAdmit ? "true" : "false",
    CIRCLE_IRIS_BASE_URL: "https://iris-api.circle.com",
  };
}
