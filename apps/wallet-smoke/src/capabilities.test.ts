import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_WALLET_API,
  assertWalletCapabilities,
} from "./capabilities.ts";

test("assertWalletCapabilities fails closed without Wallet API 0.10.3", () => {
  assert.throws(
    () =>
      assertWalletCapabilities({
        supportedWalletApi: ["0.9.0"],
        walletVersion: "1.0.0",
        featureNames: ["starknet:walletApi"],
      }),
    /0\.10\.3/,
  );
});

test("assertWalletCapabilities fails closed without starknet wallet feature", () => {
  assert.throws(
    () =>
      assertWalletCapabilities({
        supportedWalletApi: [REQUIRED_WALLET_API],
        walletVersion: "1.0.0",
        featureNames: ["standard:connect"],
      }),
    /starknet:walletApi/,
  );
});

test("assertWalletCapabilities accepts Ready with required methods surface", () => {
  const report = assertWalletCapabilities({
    supportedWalletApi: ["0.10.3", "0.10.2"],
    walletVersion: "ready-test",
    featureNames: ["starknet:walletApi", "standard:connect"],
  });
  assert.equal(report.walletApiVersion, "0.10.3");
  assert.equal(report.walletVersion, "ready-test");
  assert.deepEqual(report.requiredMethods, [
    "wallet_strk20Balances",
    "wallet_strk20PrepareInvoke",
    "wallet_strk20InvokeTransaction",
    "wallet_supportedWalletApi",
  ]);
});
