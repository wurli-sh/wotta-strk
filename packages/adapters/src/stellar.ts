import { Address, Asset, Contract, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { hexToBytes } from "viem";
import type { NonEvmCctpBurnPlan } from "./index.ts";

type FreighterApi = Pick<typeof import("@stellar/freighter-api"), "getNetworkDetails" | "requestAccess" | "signTransaction">;
const TESTNET = "Test SDF Network ; September 2015";

export async function executeStellarCctpBurn(input: {
  plan: NonEvmCctpBurnPlan;
  rpcUrl: string;
  expectedSourceAccount?: string;
  onStage?: (stage: "connecting" | "approving" | "simulating" | "signing" | "confirming") => void;
}): Promise<{ txHash: string; sourceAccount: string; approvalTxHash: string }> {
  const api = await freighter();
  input.onStage?.("connecting");
  const network = assertFreighter(await api.getNetworkDetails());
  if (network.networkPassphrase !== TESTNET) throw new Error("Switch Freighter to Stellar Testnet");
  const access = assertFreighter(await api.requestAccess());
  const source = assertStellarAddress(access.address);
  if (input.expectedSourceAccount && source !== input.expectedSourceAccount) {
    throw new Error("Freighter account changed; request a new quote");
  }
  const route = input.plan.route;
  if (route.family !== "stellar") throw new Error("Stellar plan required");
  if (input.plan.args.minFinalityThreshold !== 2000) throw new Error("Stellar requires Standard finality threshold 2000");
  const usdc = stellarUsdcContract(route.usdc, TESTNET);
  const server = new rpc.Server(input.rpcUrl);
  const ledger = await server.getLatestLedger();

  input.onStage?.("approving");
  const approvalXdr = await buildCall({
    source, server, contract: usdc, method: "approve",
    args: [new Address(source).toScVal(), new Address(route.tokenMessenger).toScVal(), nativeToScVal(BigInt(input.plan.args.amount) * 10n, { type: "i128" }), nativeToScVal(ledger.sequence + 100_000, { type: "u32" })],
  });
  const approvalTxHash = await signSubmitAndConfirm(api, server, approvalXdr, source, TESTNET);

  input.onStage?.("simulating");
  const burnXdr = await buildCall({
    source, server, contract: route.tokenMessenger, method: "deposit_for_burn_with_hook",
    args: [
      new Address(source).toScVal(),
      nativeToScVal(BigInt(input.plan.args.amount) * 10n, { type: "i128" }),
      nativeToScVal(input.plan.args.destinationDomain, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(input.plan.args.mintRecipient))),
      new Address(usdc).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(input.plan.args.destinationCaller))),
      nativeToScVal(BigInt(input.plan.args.maxFee) * 10n, { type: "i128" }),
      nativeToScVal(input.plan.args.minFinalityThreshold, { type: "u32" }),
      xdr.ScVal.scvBytes(Buffer.from(hexToBytes(input.plan.args.hookData))),
    ],
  });
  input.onStage?.("signing");
  const txHash = await signSubmitAndConfirm(api, server, burnXdr, source, TESTNET, () => input.onStage?.("confirming"));
  return { txHash, sourceAccount: source, approvalTxHash };
}

export async function connectStellarSource() {
  const api = await freighter();
  const network = assertFreighter(await api.getNetworkDetails());
  if (network.networkPassphrase !== TESTNET) throw new Error("Switch Freighter to Stellar Testnet");
  return assertStellarAddress(assertFreighter(await api.requestAccess()).address);
}

async function freighter(): Promise<FreighterApi> {
  const imported = (await import("@stellar/freighter-api")) as unknown as { default?: FreighterApi } & Partial<FreighterApi>;
  const api = (imported.default ?? imported) as Partial<FreighterApi>;
  if (!api.getNetworkDetails || !api.requestAccess || !api.signTransaction) throw new Error("Freighter API is unavailable");
  return api as FreighterApi;
}

function assertFreighter<T extends { error?: { message?: string } }>(result: T): T {
  if (result.error) throw new Error(result.error.message ?? "Freighter request failed");
  return result;
}

function assertStellarAddress(value: string): string {
  if (value.startsWith("0x") || !(value.startsWith("G") || value.startsWith("C"))) throw new Error("Stellar address must remain a native StrKey");
  return new Address(value).toString();
}

function stellarUsdcContract(canonical: string, passphrase: string) {
  const [code, issuer] = canonical.split(":");
  if (!code || !issuer) throw new Error("Invalid Stellar USDC asset");
  return new Asset(code, issuer).contractId(passphrase);
}

async function buildCall(input: { source: string; server: rpc.Server; contract: string; method: string; args: xdr.ScVal[] }) {
  const account = await input.server.getAccount(input.source);
  const transaction = new TransactionBuilder(account, { fee: "100", networkPassphrase: TESTNET })
    .addOperation(new Contract(input.contract).call(input.method, ...input.args)).setTimeout(180).build();
  const simulated = await input.server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulated)) throw new Error(`Stellar simulation failed: ${simulated.error}`);
  return rpc.assembleTransaction(transaction, simulated).build().toXDR();
}

async function signSubmitAndConfirm(api: FreighterApi, server: rpc.Server, transactionXdr: string, source: string, passphrase: string, beforeConfirm?: () => void) {
  const network = assertFreighter(await api.getNetworkDetails());
  if (network.networkPassphrase !== passphrase) throw new Error("Freighter network changed; request a new quote");
  const access = assertFreighter(await api.requestAccess());
  if (access.address !== source) throw new Error("Freighter account changed; request a new quote");
  const signed = assertFreighter(await api.signTransaction(transactionXdr, { networkPassphrase: passphrase, address: source }));
  const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, passphrase);
  const sent = await server.sendTransaction(transaction);
  if (sent.status === "ERROR") throw new Error("Stellar submission failed");
  beforeConfirm?.();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error("Stellar transaction failed");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Stellar confirmation timed out");
}
