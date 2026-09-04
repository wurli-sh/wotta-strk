import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import {
  CIRCLE_TESTNET_ROUTES,
  CIRCLE_MAINNET_ROUTES,
  buildEvmCctpBurnCalls,
  buildNonEvmCctpBurnPlan,
} from "./index.ts";
import { assertSolanaClusterForPlan } from "./solana.ts";

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
  const plan = buildEvmCctpBurnCalls({ env: "testnet", route: "base", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.equal(plan.route.chainId, 84532);
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.hookData.length, 2 + 136 * 2);
  assert.equal(plan.calls[1].to.toLowerCase(), CIRCLE_TESTNET_ROUTES.base.tokenMessenger.toLowerCase());
  assert.throws(() => decodeFunctionData({ abi: [], data: plan.calls[1].data }));
});

test("Solana and Stellar plans preserve the same Starknet router binding", () => {
  for (const route of ["solana", "stellar"] as const) {
    const plan = buildNonEvmCctpBurnPlan({ env: "testnet", route, router: "0x7e5b", amount: 1_000_000n, hook });
    assert.equal(plan.args.destinationDomain, 25);
    assert.equal(plan.args.mintRecipient, plan.args.destinationCaller);
    assert.equal(plan.args.hookData.length, 2 + 136 * 2);
  }
});

// --- Mainnet constant assertions ---

test("mainnet Base plan uses chainId 8453, domain 6, and mainnet USDC", () => {
  const plan = buildEvmCctpBurnCalls({ env: "mainnet", route: "base", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.equal(plan.route.chainId, 8453);
  assert.equal(plan.route.domain, 6);
  assert.equal(plan.route.usdc.toLowerCase(), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(plan.route.tokenMessenger.toLowerCase(), "0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
});

test("mainnet Solana plan uses mainnet USDC mint, not devnet", () => {
  const plan = buildNonEvmCctpBurnPlan({ env: "mainnet", route: "solana", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.equal(plan.route.usdc, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  // Must differ from testnet/devnet mint
  assert.notEqual(plan.route.usdc, CIRCLE_TESTNET_ROUTES.solana.usdc);
});

test("Solana plans reject an RPC from the opposite environment", () => {
  const mainnet = buildNonEvmCctpBurnPlan({ env: "mainnet", route: "solana", router: "0x7e5b", amount: 1_000_000n, hook });
  const devnet = buildNonEvmCctpBurnPlan({ env: "testnet", route: "solana", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.throws(
    () => assertSolanaClusterForPlan(mainnet, CIRCLE_TESTNET_ROUTES.solana.solanaGenesisHash!),
    /does not match/,
  );
  assert.throws(
    () => assertSolanaClusterForPlan(devnet, CIRCLE_MAINNET_ROUTES.solana!.solanaGenesisHash!),
    /does not match/,
  );
  assert.doesNotThrow(() => assertSolanaClusterForPlan(mainnet, CIRCLE_MAINNET_ROUTES.solana!.solanaGenesisHash!));
});

test("testnet Base plan still uses Sepolia chainId 84532", () => {
  const plan = buildEvmCctpBurnCalls({ env: "testnet", route: "base", router: "0x7e5b", amount: 1_000_000n, hook });
  assert.equal(plan.route.chainId, 84532);
  assert.notEqual(plan.route.chainId, 8453);
});

test("mainnet registry omits ethereum, arbitrum, and stellar", () => {
  assert.equal(CIRCLE_MAINNET_ROUTES.ethereum, undefined);
  assert.equal(CIRCLE_MAINNET_ROUTES.arbitrum, undefined);
  assert.equal(CIRCLE_MAINNET_ROUTES.stellar, undefined);
});

test("requesting an unconfigured mainnet route throws", () => {
  assert.throws(
    () => buildNonEvmCctpBurnPlan({ env: "mainnet", route: "stellar", router: "0x7e5b", amount: 1_000_000n, hook }),
    /not configured/,
  );
});
