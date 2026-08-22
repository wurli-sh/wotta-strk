function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

// Env preflight for the browser Ready/Wallet API spike in apps/wallet-smoke.
// Live STRK20 proof/submit still requires a human-controlled Ready session.
required("STARKNET_RPC_URL");
const network = process.env.VITE_STARKNET_NETWORK || process.env.STARKNET_NETWORK || "mainnet";
let privacyRoute = "wallet-api";
if (network === "sepolia") {
  privacyRoute = "direct-sdk";
  const prover = process.env.PRIVACY_PROVER_UPSTREAM ||
    "https://transaction-prover.alpha-sepolia.sw-dev.io";
  const discovery = process.env.PRIVACY_DISCOVERY_UPSTREAM ||
    "https://discovery-service.alpha-sepolia.sw-dev.io";
  const checks = await Promise.all([
    fetch(`${prover}/health`),
    fetch(`${discovery}/health`),
  ]);
  if (checks.some((response) => !response.ok)) {
    throw new Error("Sepolia hosted prover or discovery service health check failed");
  }
}

process.stdout.write(
  JSON.stringify({
    status: "ready_for_browser_spike",
    message:
      "env and privacy-service preflight passed; run pnpm dev:wallet-smoke and approve the Ready prompts",
    app: "apps/wallet-smoke",
    network,
    privacyRoute,
    evidenceFlow: "phase1-wallet-api",
  }) + "\n",
);
