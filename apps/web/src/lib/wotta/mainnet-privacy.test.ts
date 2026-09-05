import { afterEach, describe, expect, it, vi } from "vitest";
import { constants, type WalletAccountV6 } from "starknet";
import {
  MAINNET_USDC_AMOUNT,
  MAINNET_USDC_PRIVACY_FEE_RESERVE,
  buildEscrowClaimActions,
  mainnetActions,
  mainnetEscrowClaimActions,
  mainnetShieldedTransferActions,
  mainnetPrivacyConfig,
  readMainnetPrivateBalance,
  submitMainnetPrivacyAction,
  submitMainnetShieldedTransfer,
} from "./mainnet-privacy";

describe("Ready-managed mainnet privacy", () => {
  afterEach(() => vi.useRealTimers());

  it("pins the live pool, demo amount, and selected-amount allowlist", () => {
    const config = mainnetPrivacyConfig();
    expect(config.chainId).toBe("SN_MAIN");
    expect(config.amount).toBe(MAINNET_USDC_AMOUNT);
    expect(MAINNET_USDC_PRIVACY_FEE_RESERVE).toBe(250_000n);
    expect(config.allowedAmounts).toEqual([100_000n, 1_000_000n, 10_000_000n, 50_000_000n, 100_000_000n]);
    expect(config.poolAddress).toMatch(/^0x[0-9a-f]+$/i);
    expect(config.feeToken).toMatch(/^0x[0-9a-f]+$/i);
    expect(config.protocolFeeStrk).toBe(6_000_000_000_000_000_000n);
  });

  it("builds the three demo Wallet API actions", () => {
    const recipient = "0x123";
    expect(mainnetActions("shield")[0]).toMatchObject({ type: "deposit", amount: "0x186a0" });
    expect(mainnetActions("transfer", recipient)[0]).toMatchObject({ type: "transfer", amount: "0x186a0", recipient });
    expect(mainnetActions("withdraw", recipient)[0]).toMatchObject({ type: "withdraw", amount: "0x186a0", recipient });
  });

  it("builds escrow claim as an OPEN note followed by the existing claim invoke", () => {
    expect(buildEscrowClaimActions("0x1", "0x2", "0x3", "0x4")).toEqual([
      { type: "transfer", token: "0x1", amount: "OPEN", recipient: "0x2" },
      {
        type: "invoke",
        contract: "0x3",
        calldata: ["0x2", "0x0", "0x0", "0x0", "0x0", "0x4", "${openNoteIds[0]}", "0x0"],
      },
    ]);
  });

  it("rejects an escrow claim that is not one of the verified mainnet pools", () => {
    expect(() => mainnetEscrowClaimActions({
      recipient: "0x2",
      escrow: { address: "0x3", classHash: "0x4", denomination: 1_000_000n },
      claimSecret: "0x5",
    })).toThrow("mainnet_escrow_not_verified");
  });

  it("bundles the selected transfer with a private-fee reserve in order", () => {
    expect(mainnetShieldedTransferActions("0x123", 10_000_000n)).toEqual([
      expect.objectContaining({ type: "deposit", amount: "0x9c6710" }),
      expect.objectContaining({ type: "transfer", amount: "0x989680", recipient: "0x123" }),
    ]);
  });

  it("supports topping up only the missing private amount", () => {
    expect(mainnetShieldedTransferActions("0x123", 100_000n, 350_000n)).toEqual([
      expect.objectContaining({ type: "deposit", amount: "0x55730" }),
      expect.objectContaining({ type: "transfer", amount: "0x186a0", recipient: "0x123" }),
    ]);
  });

  it("rejects a missing or malformed public/private recipient", () => {
    expect(() => mainnetActions("transfer")).toThrow("invalid_private_recipient");
    expect(() => mainnetActions("withdraw", "not-an-address")).toThrow("invalid_private_recipient");
  });

  it("rejects amounts outside the manifest allowlist", () => {
    expect(() => mainnetActions("shield", undefined, 2_000_000n)).toThrow("unsupported_mainnet_denomination");
  });

  it("treats an uninitialized live-pool identity as a zero private balance", async () => {
    const account = {
      strk20Balances: async () => { throw new Error("An error occurred (NOT_REGISTERED)"); },
    } as unknown as WalletAccountV6;
    await expect(readMainnetPrivateBalance(account)).resolves.toBe(0n);
  });

  it("preserves unexpected private-balance failures", async () => {
    const account = {
      strk20Balances: async () => { throw new Error("rpc_unavailable"); },
    } as unknown as WalletAccountV6;
    await expect(readMainnetPrivateBalance(account)).rejects.toThrow("rpc_unavailable");
  });

  it("does not leave Send stuck when Ready never answers a balance request", async () => {
    vi.useFakeTimers();
    const account = {
      strk20Balances: () => new Promise<never>(() => undefined),
    } as unknown as WalletAccountV6;
    const balance = readMainnetPrivateBalance(account);
    const rejection = expect(balance).rejects.toThrow("balance_check_unresponsive");
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
  });

  it("turns Ready's raw registration failure into an actionable app error", async () => {
    const config = mainnetPrivacyConfig();
    const account = {
      provider: {
        getChainId: async () => constants.StarknetChainId.SN_MAIN,
        getClassHashAt: async () => config.poolClassHash,
      },
      strk20PrepareInvoke: async () => {
        throw new Error("An error occurred (NOT_REGISTERED)");
      },
      strk20InvokeTransaction: async () => {
        throw new Error("An error occurred (NOT_REGISTERED)");
      },
    } as unknown as WalletAccountV6;

    await expect(submitMainnetPrivacyAction(account, "shield")).rejects.toThrow(
      "mainnet_privacy_registration_required",
    );
  });

  it("simulates, validates, submits, and confirms the selected Mainnet amount", async () => {
    const config = mainnetPrivacyConfig();
    const calls: Array<{ amount: string; simulate: boolean }> = [];
    const account = {
      provider: {
        getChainId: async () => constants.StarknetChainId.SN_MAIN,
        getClassHashAt: async () => config.poolClassHash,
        waitForTransaction: async (hash: string) => ({ hash, isSuccess: () => true }),
      },
      strk20PrepareInvoke: async (actions: Array<{ amount: string }>, simulate: boolean) => {
        calls.push({ amount: actions[0]!.amount, simulate });
        return {
          call: { contract_address: config.poolAddress },
          proof: { data: "", output: [], proof_facts: [] },
        };
      },
      strk20InvokeTransaction: async (actions: Array<{ amount: string }>) => {
        calls.push({ amount: actions[0]!.amount, simulate: false });
        return { transaction_hash: "0xabc" };
      },
    } as unknown as WalletAccountV6;

    await expect(
      submitMainnetPrivacyAction(account, "transfer", "0x123", undefined, 100_000_000n),
    ).resolves.toBe("0xabc");
    expect(calls).toEqual([
      { amount: "0x5f5e100", simulate: true },
      { amount: "0x5f5e100", simulate: false },
    ]);
  });

  it("rejects a finalized but reverted private claim transaction", async () => {
    const config = mainnetPrivacyConfig();
    const account = {
      provider: {
        getChainId: async () => constants.StarknetChainId.SN_MAIN,
        getClassHashAt: async () => config.poolClassHash,
        waitForTransaction: async () => ({ isSuccess: () => false }),
      },
      strk20PrepareInvoke: async () => ({
        call: { contract_address: config.poolAddress },
        proof: { data: "", output: [], proof_facts: [] },
      }),
      strk20InvokeTransaction: async () => ({ transaction_hash: "0xbad" }),
    } as unknown as WalletAccountV6;
    await expect(submitMainnetPrivacyAction(account, "shield")).rejects.toThrow("Mainnet private transaction reverted");
  });

  it("submits shield plus transfer as one wallet transaction", async () => {
    const config = mainnetPrivacyConfig();
    const calls: Array<Array<{ type: string; amount: string }>> = [];
    const account = {
      provider: {
        getChainId: async () => constants.StarknetChainId.SN_MAIN,
        getClassHashAt: async () => config.poolClassHash,
        waitForTransaction: async (hash: string) => ({ hash, isSuccess: () => true }),
      },
      strk20PrepareInvoke: async (actions: Array<{ type: string; amount: string }>) => {
        calls.push(actions);
        return {
          call: { contract_address: config.poolAddress },
          proof: { data: "", output: [], proof_facts: [] },
        };
      },
      strk20InvokeTransaction: async (actions: Array<{ type: string; amount: string }>) => {
        calls.push(actions);
        return { transaction_hash: "0xdef" };
      },
    } as unknown as WalletAccountV6;

    await expect(
      submitMainnetShieldedTransfer(account, "0x123", undefined, 10_000_000n),
    ).resolves.toBe("0xdef");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.map((action) => action.type)).toEqual(["deposit", "transfer"]);
    expect(calls[1]?.map((action) => action.type)).toEqual(["deposit", "transfer"]);
  });

  it("fails closed before signing when the connected chain is not Mainnet", async () => {
    const config = mainnetPrivacyConfig();
    let invoked = false;
    const account = {
      provider: {
        getChainId: async () => constants.StarknetChainId.SN_SEPOLIA,
        getClassHashAt: async () => config.poolClassHash,
      },
      strk20PrepareInvoke: async () => {
        throw new Error("should not simulate");
      },
      strk20InvokeTransaction: async () => {
        invoked = true;
        return { transaction_hash: "0xabc" };
      },
    } as unknown as WalletAccountV6;

    await expect(submitMainnetPrivacyAction(account, "shield")).rejects.toThrow("ready_mainnet_network_mismatch");
    expect(invoked).toBe(false);
  });
});
