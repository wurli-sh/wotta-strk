import type { PrivateTransfersInterface } from "@starkware-libs/starknet-privacy-sdk";
import type { WottaSourceRoute } from "@wotta/adapters";
import type { Denomination } from "@wotta/shared";
import { connectReady } from "./connect.ts";
import { requireDirectPrivacy, type SmokeConfig } from "./config.ts";
import { renderDirectApp } from "./direct-ui.ts";
import type { ConnectedWallet } from "./flow.ts";
import {
  createPrivacyClient,
  deployPrivacyIdentity,
  isIdentityRegistered,
} from "./privacy-account.ts";
import {
  privateBalance,
  claimPrivateFund,
  createPrivateFundPackage,
  privateFund,
  privateTransfer,
  registerIdentity,
  refundPrivateFund,
  shieldUsdc,
} from "./privacy-flow.ts";
import { unlockPrivacyVault, type PrivacyVault } from "./privacy-state.ts";
import { consumeOAuthCallbackFailure, createProductSession } from "./product-session.ts";
import { createSession } from "./session.ts";
import type { SmokeFlowId } from "./types.ts";
import { setBusy, setStatus, truncate, type FlowUi } from "./ui.ts";

export function startDirectApp(app: HTMLElement, config: SmokeConfig): void {
  const direct = requireDirectPrivacy(config);
  const ui = renderDirectApp(app);
  const oauthCallbackFailure = consumeOAuthCallbackFailure();
  const product = createProductSession(config);
  const session = createSession({
    version: 1,
    kind: "wotta-wallet-smoke-session",
    createdAt: new Date().toISOString(),
    manifestHash: config.manifestHash,
    chainId: config.chainId,
    usdc: direct.usdc,
    readyUsdc: direct.usdc,
    strk20Pool: direct.poolAddress,
    strk20ClassHash: direct.poolClassHash,
    starknetJs: config.starknetJs,
    walletApiSchema: config.walletApiSchema,
    privacyRoute: "direct-sdk",
  });
  let connected: ConnectedWallet | undefined;
  let vault: PrivacyVault | undefined;
  let transfers: PrivateTransfersInterface | undefined;
  let minimumProofBlock: number | undefined;
  let inboxClaimEscrow: NonNullable<typeof direct.escrow> | undefined;
  let authRequestInFlight = false;

  const refreshAuth = async () => {
    if (!product) {
      ui.authStatus.textContent = "Set VITE_WOTTA_API_URL and Supabase public envs";
      ui.authGoogle.disabled = true;
      ui.authX.disabled = true;
      ui.authUnlinkGoogle.disabled = true;
      ui.authUnlinkX.disabled = true;
      return;
    }
    const state = await product.authState();
    ui.authStatus.textContent = state.label ?? "Not signed in";
    if (state.label) {
      try { await product.syncSession(); }
      catch (error) { ui.authStatus.textContent = `Wotta sync failed: ${error instanceof Error ? error.message : String(error)}`; }
    }
    ui.authGoogle.textContent = state.providers.includes("google") ? "Google linked" : "Connect Google";
    ui.authX.textContent = state.providers.includes("x") ? "X linked" : "Connect X";
    ui.authGoogle.disabled = authRequestInFlight;
    ui.authX.disabled = authRequestInFlight;
    ui.authUnlinkGoogle.disabled = authRequestInFlight || !state.providers.includes("google") || state.providers.length <= 1;
    ui.authUnlinkX.disabled = authRequestInFlight || !state.providers.includes("x") || state.providers.length <= 1;
  };
  void refreshAuth().finally(() => {
    if (oauthCallbackFailure) ui.authStatus.textContent = oauthCallbackFailure.message;
  });
  const runAuth = async (work: () => Promise<unknown>) => {
    if (authRequestInFlight) return;
    authRequestInFlight = true;
    ui.authGoogle.disabled = true;
    ui.authX.disabled = true;
    ui.authUnlinkGoogle.disabled = true;
    ui.authUnlinkX.disabled = true;
    let failure: unknown;
    try { await work(); }
    catch (error) { failure = error; }
    finally {
      authRequestInFlight = false;
      try { await refreshAuth(); }
      catch (error) { failure ??= error; }
      if (failure) ui.authStatus.textContent = failure instanceof Error ? failure.message : String(failure);
    }
  };
  ui.authGoogle.addEventListener("click", () => void (product && runAuth(() => product.connectProvider("google"))));
  ui.authX.addEventListener("click", () => void (product && runAuth(() => product.connectProvider("x"))));
  ui.authUnlinkGoogle.addEventListener("click", () => void (product && runAuth(() => product.unlinkProvider("google"))));
  ui.authUnlinkX.addEventListener("click", () => void (product && runAuth(() => product.unlinkProvider("x"))));

  const refreshSummary = () => {
    ui.sessionSummary.textContent = `${session.file.events.length} event(s) · pool ${truncate(direct.poolAddress)}`;
  };
  const recordError = (flow: FlowUi, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(flow, "error", message);
    session.record({ at: new Date().toISOString(), flow: flow.id as SmokeFlowId, status: "error", message, error: message });
    refreshSummary();
  };
  const run = async (flow: FlowUi, work: () => Promise<void>) => {
    setBusy(flow.run, true);
    try { await work(); } catch (error) { recordError(flow, error); }
    finally { flow.run.setAttribute("aria-busy", "false"); flow.run.disabled = !connected; }
  };
  const requireConnected = () => {
    if (!connected || !vault) throw new Error("Connect Ready and unlock privacy state first");
    return { connected, vault };
  };
  const requireTransfers = () => {
    if (!transfers || !vault?.state.identityAddress) {
      throw new Error("Register the private identity first");
    }
    return { transfers, identity: vault.state.identityAddress };
  };
  const rememberPrivateState = async (transactionHash: string): Promise<void> => {
    if (!connected) return;
    const receipt = await connected.account.provider.waitForTransaction(transactionHash);
    if ("block_number" in receipt && typeof receipt.block_number === "number") {
      minimumProofBlock = receipt.block_number;
    }
  };
  const showIdentity = (identity: string) => {
    ui.identityAddress.textContent = truncate(identity);
    ui.identityAddress.title = identity;
    ui.copyIdentity.disabled = false;
  };
  const proofStatus = (flow: FlowUi) => (phase: string) => {
    const labels: Record<string, string> = {
      funding_identity: "Funding the private identity and approving the pool…",
      waiting_confirmations: "Waiting for Sepolia state to become proof-safe (10 blocks)…",
      building_proof: "Building the signed proof invocation…",
      signing_message: "Approve the privacy authorization in Ready…",
      generating_proof: "Hosted prover is generating the STARK proof…",
      submitting: "Local Sepolia paymaster is submitting the proof…",
    };
    setStatus(flow, "loading", labels[phase] ?? phase);
  };

  const ensurePrivateIdentity = async (): Promise<string> => {
    const ctx = requireConnected();
    let identity = ctx.vault.state.identityAddress;
    let deploymentBlock: number | undefined;
    if (!identity) {
      setStatus(ui.flows.register_identity, "loading", "Approve creation of your private Wotta identity in Ready…");
      const deployed = await deployPrivacyIdentity(ctx.connected.account, direct);
      identity = deployed.address;
      deploymentBlock = deployed.blockNumber;
      await ctx.vault.setIdentityAddress(identity);
      showIdentity(identity);
      session.file.privacyIdentity = identity;
    }
    transfers = createPrivacyClient(identity, BigInt(ctx.vault.state.viewingKey), direct);
    if (!await isIdentityRegistered(ctx.connected.account, direct, identity)) {
      const tx = await registerIdentity(
        ctx.connected.account,
        transfers,
        proofStatus(ui.flows.register_identity),
        deploymentBlock,
      );
      await rememberPrivateState(tx);
      session.record({ at: new Date().toISOString(), flow: "register_identity", status: "ok", message: "privacy identity registered through direct SDK", transactionHash: tx, poolAddress: direct.poolAddress });
      setStatus(ui.flows.register_identity, "success", `Private balance ready · ${truncate(tx)}`);
      refreshSummary();
    } else {
      setStatus(ui.flows.register_identity, "success", "Private balance ready");
    }
    return identity;
  };

  ui.connect.addEventListener("click", () => void (async () => {
    ui.connect.disabled = true;
    ui.connect.textContent = "Connecting…";
    try {
      await assertHostedServices();
      connected = await connectReady(config);
      ui.walletAddress.textContent = truncate(connected.address);
      ui.walletAddress.title = connected.address;
      ui.walletMeta.textContent = `${connected.walletId} · wallet ${connected.walletVersion}`;
      vault = await unlockPrivacyVault(connected.account, direct);
      const identity = vault.state.identityAddress;
      if (identity) {
        showIdentity(identity);
        transfers = createPrivacyClient(identity, BigInt(vault.state.viewingKey), direct);
      }
      session.file.address = connected.address;
      session.file.walletId = connected.walletId;
      session.file.walletVersion = connected.walletVersion;
      if (identity) session.file.privacyIdentity = identity;
      session.record({ at: new Date().toISOString(), flow: "connect", status: "ok", message: "Ready connected and encrypted privacy state unlocked", poolAddress: direct.poolAddress });
      Object.values(ui.flows).forEach((flow) => { flow.run.disabled = false; });
      ui.loadInbox.disabled = !product;
      if (!product) {
        ui.flows.cctp_fund.run.disabled = true;
        setStatus(ui.flows.cctp_fund, "error", "Set the Wotta API and Supabase browser envs first");
      }
      if (!direct.escrow) {
        for (const id of ["private_fund", "claim_release", "private_refund"] as const) {
          ui.flows[id].run.disabled = true;
          setStatus(ui.flows[id], "error", "Wotta compatible private escrow is not configured");
        }
      }
      ui.connect.textContent = "Connected";
      refreshSummary();

      // Ready is already connected at this point. Product-profile synchronization is
      // a separate dependency and must not turn a healthy wallet session into a
      // misleading "Retry Ready" state.
      if (product) {
        try {
          if (await product.userLabel()) {
            await product.bindReadyAndIdentity(connected.account, vault, identity);
            const readyIdentity = await ensurePrivateIdentity();
            await product.publishPrivateIdentity(readyIdentity);
            await product.syncSession();
            await refreshAuth();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ui.authStatus.textContent = `Wotta onboarding paused: ${message}`;
        }
      }
    } catch (error) {
      ui.connect.disabled = false;
      ui.connect.textContent = "Retry Ready";
      ui.walletMeta.textContent = error instanceof Error ? error.message : String(error);
    }
  })());

  ui.loadInbox.addEventListener("click", () => void (async () => {
    if (!product || !vault) return;
    ui.loadInbox.disabled = true;
    ui.loadInbox.textContent = "Loading…";
    try {
      const claim = await product.loadLatestClaim(vault);
      inboxClaimEscrow = claim.escrow;
      ui.claimSecret.value = claim.claimSecret;
      ui.loadInbox.textContent = `Loaded ${claim.escrow.denomination / 1_000_000n} USDC`;
      setStatus(ui.flows.claim_release, "success", "Encrypted claim loaded. Run Claim / release after the destination escrow is funded.");
    } catch (error) {
      ui.loadInbox.textContent = "Load inbox";
      setStatus(ui.flows.claim_release, "error", error instanceof Error ? error.message : String(error));
    } finally {
      ui.loadInbox.disabled = false;
    }
  })());
  ui.claimSecret.addEventListener("input", () => { inboxClaimEscrow = undefined; });

  ui.flows.cctp_fund.run.addEventListener("click", () => void run(ui.flows.cctp_fund, async () => {
    const ctx = requireConnected();
    if (!product) throw new Error("Wotta API and Supabase browser envs are required");
    const recipient = ui.recipient.value.trim();
    if (!recipient) throw new Error("Enter the recipient email or @handle");
    const stageLabels: Record<string, string> = {
      resolving: "Resolving the recipient and verified destination route…",
      connecting_source: "Connect the selected source-chain wallet…",
      quoting: "Quoting Circle fees for the exact recipient amount…",
      delivering: "Encrypting the claim package to the recipient inbox…",
      approving: "Approve native Circle USDC for the CCTP burn…",
      burning: "Approve the Circle CCTP V2 burn…",
      confirming: "Waiting for the source-chain burn confirmation…",
      settling: "Source burn confirmed. Circle and Wotta are minting and escrowing on Starknet…",
    };
    const result = await product.fundFromCircleSource({
      route: ui.sourceRoute.value as WottaSourceRoute,
      denomination: ui.sourceDenomination.value as Denomination,
      recipient,
      publicRefundRecipient: ctx.connected.address,
      onStage: (stage) => setStatus(ui.flows.cctp_fund, "loading", stageLabels[stage] ?? stage),
      onRecovery: (recovery) => {
        ui.generatedClaimSecret.value = recovery.claimSecret;
        ui.generatedRefundSecret.value = "Public refund returns to the connected Ready account";
        ui.copyGeneratedClaim.disabled = false;
        ui.copyGeneratedRefund.disabled = true;
      },
    });
    const amount = BigInt(ui.sourceDenomination.value) / 1_000_000n;
    setStatus(ui.flows.cctp_fund, "success", `Escrowed ${amount} USDC for the recipient · source ${truncate(result.sourceTxHash)}`);
    session.record({
      at: new Date().toISOString(),
      flow: "cctp_fund",
      status: "ok",
      message: `Circle CCTP source burn submitted for intent ${result.intentId}`,
      transactionHash: result.sourceTxHash,
      poolAddress: result.escrow,
    });
    refreshSummary();
  }));

  ui.flows.register_identity.run.addEventListener("click", () => void run(ui.flows.register_identity, async () => {
    const identity = await ensurePrivateIdentity();
    if (product && await product.userLabel()) await product.bindReadyAndIdentity(requireConnected().connected.account, requireConnected().vault, identity);
  }));

  ui.flows.shield_register.run.addEventListener("click", () => void run(ui.flows.shield_register, async () => {
    const ctx = requireConnected();
    const privateCtx = requireTransfers();
    if (!await isIdentityRegistered(ctx.connected.account, direct, privateCtx.identity)) throw new Error("Register the private identity first");
    const result = await shieldUsdc(ctx.connected.account, privateCtx.transfers, privateCtx.identity, direct, BigInt(config.smokeAmount), proofStatus(ui.flows.shield_register));
    await rememberPrivateState(result.privacyTx);
    setStatus(ui.flows.shield_register, "success", `Shielded in ${truncate(result.privacyTx)}`);
    session.record({ at: new Date().toISOString(), flow: "shield_register", status: "ok", message: "public USDC shielded through direct SDK", transactionHash: result.privacyTx, poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.flows.balances.run.addEventListener("click", () => void run(ui.flows.balances, async () => {
    const privateCtx = requireTransfers();
    setStatus(ui.flows.balances, "loading", "Discovering and decrypting private notes…");
    const balance = await privateBalance(privateCtx.transfers, direct.usdc);
    ui.flows.balances.detail.textContent = `${balance} base units (${Number(balance) / 1_000_000} USDC)`;
    setStatus(ui.flows.balances, "success", "Private balance read");
    session.record({ at: new Date().toISOString(), flow: "balances", status: "ok", message: "direct SDK note discovery", balances: [{ token: direct.usdc, balance: String(balance) }], poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.flows.direct_transfer.run.addEventListener("click", () => void run(ui.flows.direct_transfer, async () => {
    const ctx = requireConnected();
    const privateCtx = requireTransfers();
    const recipientInput = ui.recipient.value.trim();
    let recipient = recipientInput;
    if (!/^0x[0-9a-f]+$/i.test(recipientInput)) {
      if (!ui.purePrivacy.checked) throw new Error("Raw mode requires a private identity address");
      if (!product) throw new Error("Wotta API and Supabase public envs are required for handle resolution");
      setStatus(ui.flows.direct_transfer, "loading", "Resolving the recipient's verified private identity…");
      recipient = await product.resolvePrivateRecipient(recipientInput, direct.poolAddress);
    }
    if (!await isIdentityRegistered(ctx.connected.account, direct, recipient)) throw new Error("Recipient private identity is not registered");
    const tx = await privateTransfer(ctx.connected.account, privateCtx.transfers, direct.usdc, recipient, BigInt(config.smokeAmount), proofStatus(ui.flows.direct_transfer), minimumProofBlock);
    await rememberPrivateState(tx);
    setStatus(ui.flows.direct_transfer, "success", `Transferred ${truncate(tx)}`);
    session.record({ at: new Date().toISOString(), flow: "direct_transfer", status: "ok", message: "direct SDK private transfer", transactionHash: tx, poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.flows.private_fund.run.addEventListener("click", () => void run(ui.flows.private_fund, async () => {
    const ctx = requireConnected();
    const privateCtx = requireTransfers();
    const payment = createPrivateFundPackage();
    const tx = await privateFund(
      ctx.connected.account,
      privateCtx.transfers,
      direct,
      payment,
      proofStatus(ui.flows.private_fund),
      minimumProofBlock,
    );
    await rememberPrivateState(tx);
    ui.generatedClaimSecret.value = payment.claimSecret;
    ui.generatedRefundSecret.value = payment.refundSecret;
    ui.copyGeneratedClaim.disabled = false;
    ui.copyGeneratedRefund.disabled = false;
    setStatus(ui.flows.private_fund, "success", `Funded Wotta escrow in ${truncate(tx)}. Share the claim secret privately and save the refund secret.`);
    session.record({ at: new Date().toISOString(), flow: "private_fund", status: "ok", message: "private USDC funded the configured Wotta escrow", transactionHash: tx, poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.flows.claim_release.run.addEventListener("click", () => void run(ui.flows.claim_release, async () => {
    const ctx = requireConnected();
    const privateCtx = requireTransfers();
    const secret = ui.claimSecret.value.trim();
    if (!secret) throw new Error("Enter the claim secret supplied with the payment");
    const claimConfig = inboxClaimEscrow ? { ...direct, escrow: inboxClaimEscrow } : direct;
    const tx = await claimPrivateFund(ctx.connected.account, privateCtx.transfers, claimConfig, secret, proofStatus(ui.flows.claim_release), minimumProofBlock);
    await rememberPrivateState(tx);
    setStatus(ui.flows.claim_release, "success", `Claimed into a private note in ${truncate(tx)}`);
    session.record({ at: new Date().toISOString(), flow: "claim_release", status: "ok", message: "Wotta escrow released to an open private note", transactionHash: tx, poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.flows.private_refund.run.addEventListener("click", () => void run(ui.flows.private_refund, async () => {
    const ctx = requireConnected();
    const privateCtx = requireTransfers();
    const secret = ui.refundSecret.value.trim();
    if (!secret) throw new Error("Enter the refund secret after the payment expiry");
    const tx = await refundPrivateFund(ctx.connected.account, privateCtx.transfers, direct, secret, proofStatus(ui.flows.private_refund), minimumProofBlock);
    await rememberPrivateState(tx);
    setStatus(ui.flows.private_refund, "success", `Refunded into a private note in ${truncate(tx)}`);
    session.record({ at: new Date().toISOString(), flow: "private_refund", status: "ok", message: "expired Wotta payment refunded to an open private note", transactionHash: tx, poolAddress: direct.poolAddress });
    refreshSummary();
  }));

  ui.exportSession.addEventListener("click", () => {
    const blob = new Blob([session.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `wotta-direct-sdk-${config.manifestHash.slice(0, 12)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  ui.copyIdentity.addEventListener("click", () => void (async () => {
    const identity = vault?.state.identityAddress;
    if (!identity) return;
    try {
      await navigator.clipboard.writeText(identity);
      ui.copyIdentity.textContent = "Copied";
      window.setTimeout(() => { ui.copyIdentity.textContent = "Copy"; }, 1_500);
    } catch {
      ui.copyIdentity.textContent = "Copy failed";
      window.setTimeout(() => { ui.copyIdentity.textContent = "Copy"; }, 2_000);
    }
  })());

  wireCopy(ui.copyGeneratedClaim, () => ui.generatedClaimSecret.value);
  wireCopy(ui.copyGeneratedRefund, () => ui.generatedRefundSecret.value);
}

function wireCopy(button: HTMLButtonElement, value: () => string): void {
  button.addEventListener("click", () => void (async () => {
    const secret = value();
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      button.textContent = "Copied";
      window.setTimeout(() => { button.textContent = "Copy"; }, 1_500);
    } catch {
      button.textContent = "Copy failed";
      window.setTimeout(() => { button.textContent = "Copy"; }, 2_000);
    }
  })());
}

async function assertHostedServices(): Promise<void> {
  const responses = await Promise.all([
    fetch("/privacy/prover/health"),
    fetch("/privacy/discovery/health"),
  ]);
  if (responses.some((response) => !response.ok)) {
    throw new Error("Hosted Sepolia prover or discovery service is unavailable");
  }
}
