import mainnetDeployment from "../../../deployments/mainnet.json" with { type: "json" };
import sepoliaDeployment from "../../../deployments/sepolia.json" with { type: "json" };
import { connectReady } from "./connect.ts";
import { startDirectApp } from "./direct-app.ts";
import {
  assertHelperConfigured,
  loadSmokeConfig,
  type SmokeManifest,
} from "./config.ts";
import {
  actionsForFlow,
  prepareGatedInvoke,
  readBalances,
  readPublicBalance,
  submitStrk20Invoke,
  submitPreparedInvoke,
  type ConnectedWallet,
} from "./flow.ts";
import { createSession, summarizeDeposits } from "./session.ts";
import type { SmokeFlowId } from "./types.ts";
import {
  getFlowUi,
  renderApp,
  setBusy,
  setStatus,
  truncate,
  type FlowUi,
} from "./ui.ts";
import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("app root missing");
const buildEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
const network = buildEnv.VITE_STARKNET_NETWORK?.trim() || "mainnet";
if (network !== "mainnet" && network !== "sepolia") {
  throw new Error("VITE_STARKNET_NETWORK must be mainnet or sepolia");
}
const deployment: SmokeManifest = network === "sepolia"
  ? sepoliaDeployment as SmokeManifest
  : mainnetDeployment as SmokeManifest;

const env = {
  VITE_STARKNET_RPC_URL: buildEnv.VITE_STARKNET_RPC_URL as
    | string
    | undefined,
  VITE_HELPER_ADDRESS: buildEnv.VITE_HELPER_ADDRESS as
    | string
    | undefined,
  VITE_TRANSFER_RECIPIENT: buildEnv.VITE_TRANSFER_RECIPIENT as
    | string
    | undefined,
  VITE_SMOKE_AMOUNT: buildEnv.VITE_SMOKE_AMOUNT as string | undefined,
  VITE_READY_USDC_ADDRESS: buildEnv.VITE_READY_USDC_ADDRESS as
    | string
    | undefined,
  VITE_WOTTA_API_URL: buildEnv.VITE_WOTTA_API_URL as string | undefined,
  VITE_SUPABASE_URL: buildEnv.VITE_SUPABASE_URL as string | undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
  VITE_SOLANA_DEVNET_RPC_URL: buildEnv.VITE_SOLANA_DEVNET_RPC_URL as string | undefined,
  VITE_STELLAR_TESTNET_RPC_URL: buildEnv.VITE_STELLAR_TESTNET_RPC_URL as string | undefined,
};

const config = loadSmokeConfig(env, deployment as SmokeManifest);
if (network === "sepolia") {
  startDirectApp(app, config);
} else {
renderApp(app, deployment.chainId);
const session = createSession({
  version: 1,
  kind: "wotta-wallet-smoke-session",
  createdAt: new Date().toISOString(),
  manifestHash: config.manifestHash,
  chainId: config.chainId,
  usdc: config.usdc,
  readyUsdc: config.readyUsdc,
  strk20Pool: config.strk20Pool,
  starknetJs: config.starknetJs,
  walletApiSchema: config.walletApiSchema,
  ...(config.strk20ClassHash
    ? { strk20ClassHash: config.strk20ClassHash }
    : {}),
});

const connectButton =
  document.querySelector<HTMLButtonElement>("#connect-wallet")!;
const addressLabel = document.querySelector<HTMLElement>("#wallet-address")!;
const walletMeta = document.querySelector<HTMLElement>("#wallet-meta")!;
const exportButton =
  document.querySelector<HTMLButtonElement>("#export-session")!;
const sessionSummary = document.querySelector<HTMLElement>("#session-summary")!;
const recipientInput =
  document.querySelector<HTMLInputElement>("#input-recipient")!;
const commitmentInput =
  document.querySelector<HTMLInputElement>("#input-commitment")!;
const secretInput = document.querySelector<HTMLInputElement>("#input-secret")!;

const flows: SmokeFlowId[] = [
  "shield_register",
  "balances",
  "direct_transfer",
  "private_fund",
  "claim_release",
];
const readyManagedFlows = new Set<SmokeFlowId>([
  "shield_register",
  "balances",
  "direct_transfer",
]);
const flowUi = Object.fromEntries(
  flows.map((id) => [id, getFlowUi(id)]),
) as Record<SmokeFlowId, FlowUi>;

let connected: ConnectedWallet | undefined;
if (config.transferRecipient) recipientInput.value = config.transferRecipient;

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

function isNotRegistered(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("NOT_REGISTERED");
}

function refreshSessionSummary(): void {
  sessionSummary.textContent =
    `${session.file.events.length} event(s) · manifest ${truncate(config.manifestHash)}`;
}

function setFlowsEnabled(enabled: boolean): void {
  for (const id of flows) {
    flowUi[id].run.disabled = !enabled || !readyManagedFlows.has(id);
  }
  if (enabled) {
    setStatus(
      flowUi.private_fund,
      "error",
      "Gated until Ready pool binding and escrow calldata are verified",
    );
    setStatus(
      flowUi.claim_release,
      "error",
      "Gated until Ready pool binding and escrow calldata are verified",
    );
  }
}

async function handle(ui: FlowUi, work: () => Promise<void>): Promise<void> {
  setBusy(ui.run, true);
  try {
    await work();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected wallet error";
    setStatus(ui, "error", message);
    session.record({
      at: new Date().toISOString(),
      flow: ui.id as SmokeFlowId,
      status: "error",
      message,
      error: message,
    });
    refreshSessionSummary();
  } finally {
    ui.run.setAttribute("aria-busy", "false");
    if (connected) ui.run.disabled = false;
  }
}

connectButton.addEventListener("click", () => {
  void (async () => {
    connectButton.disabled = true;
    connectButton.textContent = "Connecting…";
    try {
      connected = await connectReady(config);
      session.file.address = connected.address;
      session.file.walletId = connected.walletId;
      session.file.walletVersion = connected.walletVersion;
      session.file.supportedWalletApi = connected.supportedWalletApi;
      addressLabel.textContent = truncate(connected.address);
      addressLabel.title = connected.address;
      walletMeta.textContent =
        `${connected.walletId} · wallet ${connected.walletVersion} · API ${connected.capabilities.walletApiVersion}`;
      connectButton.textContent = "Connected";
      session.record({
        at: new Date().toISOString(),
        flow: "capabilities",
        status: "ok",
        message:
          "Ready connected; STRK20 methods gated behind Wallet API 0.10.3",
        walletApiVersions: connected.supportedWalletApi,
        walletVersion: connected.walletVersion,
        poolAddress: config.strk20Pool,
        ...(config.strk20ClassHash
          ? { classHash: config.strk20ClassHash }
          : {}),
      });
      refreshSessionSummary();
      setFlowsEnabled(true);
      setStatus(flowUi.balances, "success", "Capability gate passed");
    } catch (error) {
      connectButton.textContent = "Retry Ready";
      connectButton.disabled = false;
      const message =
        error instanceof Error ? error.message : "Connection failed";
      addressLabel.textContent = message;
      session.record({
        at: new Date().toISOString(),
        flow: "connect",
        status: "error",
        message,
        error: message,
      });
      refreshSessionSummary();
    }
  })();
});

flowUi.balances.run.addEventListener("click", () => {
  void handle(flowUi.balances, async () => {
    if (!connected) throw new Error("Connect Ready first");
    setStatus(
      flowUi.balances,
      "loading",
      "Reading private USDC balance (safe read)…",
    );
    const balances = await readBalances(connected.account, config);
    flowUi.balances.detail.textContent = balances
      .map((entry) => `${truncate(entry.token)} = ${entry.balance}`)
      .join(" · ");
    setStatus(flowUi.balances, "success", "Balances read");
    session.record({
      at: new Date().toISOString(),
      flow: "balances",
      status: "ok",
      message: "strk20Balances safe read",
      balances,
      poolAddress: config.strk20Pool,
      ...(config.strk20ClassHash
        ? { classHash: config.strk20ClassHash }
        : {}),
    });
    refreshSessionSummary();
  });
});

function wireRiskyFlow(flow: Exclude<SmokeFlowId, "balances">): void {
  flowUi[flow].run.addEventListener("click", () => {
    void handle(flowUi[flow], async () => {
      if (!connected) throw new Error("Connect Ready first");
      const recipient =
        recipientInput.value.trim() ||
        config.transferRecipient ||
        connected.address;
      if (flow === "private_fund" || flow === "claim_release") {
        assertHelperConfigured(config);
      }
      const commitmentHash = commitmentInput.value.trim() || "0x1";
      const secret = secretInput.value.trim();
      if (flow === "claim_release" && !secret) {
        throw new Error("Claim secret required");
      }
      const built = actionsForFlow(flow, config, {
        recipient,
        commitmentHash,
        secret: secret || "0x0",
      });
      if (flow === "shield_register") {
        const publicBalance = await readPublicBalance(
          connected.account,
          config.readyUsdc,
          connected.address,
        );
        const required = BigInt(config.smokeAmount);
        flowUi[flow].detail.textContent =
          `Public Ready-route USDC: ${publicBalance} base units · required ${required}`;
        if (publicBalance < required) {
          throw new Error(
            `Need at least ${required} base units (1 USDC) of Sepolia USDC before shielding`,
          );
        }
      }
      setStatus(
        flowUi[flow],
        "loading",
        "Simulating with strk20PrepareInvoke(actions, true)…",
      );
      let prepared;
      try {
        prepared = await prepareGatedInvoke(
          connected.account,
          flow,
          built.actions,
          built.expected,
        );
      } catch (error) {
        if (flow !== "shield_register" || !isNotRegistered(error)) throw error;

        setStatus(
          flowUi[flow],
          "loading",
          "Ready needs to initialize private state. Approve its registration + shield request…",
        );
        const submitted = await submitStrk20Invoke(connected.account, built.actions);
        flowUi[flow].detail.textContent =
          "Ready registration and 1 USDC shield submitted. Next, run Private balances.";
        setStatus(
          flowUi[flow],
          "success",
          `Submitted ${truncate(submitted.transactionHash)}`,
        );
        session.record({
          at: new Date().toISOString(),
          flow,
          status: "ok",
          message: "shield_register invoked directly after simulated preview returned NOT_REGISTERED",
          actions: built.actions,
          expectedNoteDeposits: built.expected,
          noteDeposits: submitted.observedNoteDeposits,
          transactionHash: submitted.transactionHash,
          walletVersion: connected.walletVersion,
          walletApiVersions: connected.supportedWalletApi,
        });
        refreshSessionSummary();
        return;
      }
      const readyPoolAddress = prepared.prepared.contractAddress;
      const poolMatch = sameFelt(readyPoolAddress, config.strk20Pool);
      flowUi[flow].detail.textContent = flow === "shield_register"
        ? `Ready pool ${truncate(readyPoolAddress)} · ${poolMatch ? "matches" : "differs from"} Wotta manifest pool · shielding ${config.smokeAmount} base units of ${truncate(config.readyUsdc)}`
        : `Simulated empty proof · call ${truncate(prepared.prepared.contractAddress)} · expected ${summarizeDeposits(prepared.expectedNoteDeposits)}`;
      setStatus(
        flowUi[flow],
        "loading",
        "Waiting on Ready proof UI (this can take a long time)…",
      );
      const submitted = await submitPreparedInvoke(connected.account, prepared);
      setStatus(
        flowUi[flow],
        "success",
        `Submitted ${truncate(submitted.transactionHash)}`,
      );
      session.record({
        at: new Date().toISOString(),
        flow,
        status: "ok",
        message: `${flow} simulated then invoked`,
        actions: prepared.actions,
        prepared: prepared.prepared,
        expectedNoteDeposits: prepared.expectedNoteDeposits,
        noteDeposits: submitted.observedNoteDeposits,
        transactionHash: submitted.transactionHash,
        poolAddress: readyPoolAddress,
        ...(config.strk20ClassHash
          ? { classHash: config.strk20ClassHash }
          : {}),
        walletVersion: connected.walletVersion,
        walletApiVersions: connected.supportedWalletApi,
      });
      refreshSessionSummary();
    });
  });
}

wireRiskyFlow("direct_transfer");
wireRiskyFlow("shield_register");

exportButton.addEventListener("click", () => {
  const blob = new Blob([session.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download =
    `wotta-wallet-smoke-${config.manifestHash.slice(0, 12)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});
}
