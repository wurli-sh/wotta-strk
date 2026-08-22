import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { CIRCLE_TESTNET_ROUTES, buildEvmCctpBurnCalls, buildNonEvmCctpBurnPlan } from "./index.ts";

const hook = {
  intentId: "123e4567-e89b-42d3-a456-426614174000",
  denominationCode: 0,
  escrowPool: "0x1234",
  claimHash: "0x5678",
  publicRefundRecipient: "0x9abc",
  expiresAt: 1_800_000_000n,
  manifestVersion: 1,
} as const;

test("EVM adapter emits approve then Circle depositForBurnWithHook", () => {
  const plan = buildEvmCctpBurnCalls({ route: "base", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.equal(plan.route.chainId, 84532);
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.hookData.length, 2 + 136 * 2);
  assert.equal(plan.calls[1].to.toLowerCase(), CIRCLE_TESTNET_ROUTES.base.tokenMessenger.toLowerCase());
  assert.throws(() => decodeFunctionData({ abi: [], data: plan.calls[1].data }));
});

test("Solana and Stellar plans preserve the same Starknet router binding", () => {
  for (const route of ["solana", "stellar"] as const) {
    const plan = buildNonEvmCctpBurnPlan({ route, router: "0x7e5b", amount: 1_000_000n, hook });
    assert.equal(plan.args.destinationDomain, 25);
    assert.equal(plan.args.mintRecipient, plan.args.destinationCaller);
    assert.equal(plan.args.hookData.length, 2 + 136 * 2);
  }
});
