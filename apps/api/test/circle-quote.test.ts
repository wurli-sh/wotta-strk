import assert from "node:assert/strict";
import test from "node:test";
import { decimalRational, decimalTokenUnits, quoteCircleExactNet, solveExactNet } from "../src/quotes/circle.ts";

test("Circle exact-net quote selects finality and buffers its fee", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([
    { finalityThreshold: 1000, minimumFee: 1 },
    { finalityThreshold: 2000, minimumFee: "0.5" },
  ]));
  const quote = await quoteCircleExactNet({ irisBaseUrl: "https://iris.example", sourceDomain: 6, destinationDomain: 25, requestedReceive: 1_000_000n, minFinalityThreshold: 2000, fetchImpl: fetchImpl as typeof fetch });
  assert.ok(quote.grossDebit - quote.maxFee >= 1_000_000n);
  assert.ok(quote.maxFee > 0n);
});

test("exact-net arithmetic remains integer-only", () => {
  assert.deepEqual(decimalRational("1.25"), { numerator: 125n, denominator: 100n });
  assert.equal(decimalTokenUnits("12.3456789", 6), 12_345_678n);
  assert.deepEqual(solveExactNet(1_000_000n, () => 20n), { grossDebit: 1_000_020n, maxFee: 20n, minimumReceive: 1_000_000n });
});

test("Fast quote fails closed when Circle allowance cannot cover the burn", async () => {
  const fetchImpl = async (url: string | URL | Request) => String(url).includes("/allowance")
    ? new Response(JSON.stringify({ allowance: "0.099999" }))
    : new Response(JSON.stringify([{ finalityThreshold: 1000, minimumFee: 1 }]));
  await assert.rejects(
    () => quoteCircleExactNet({ irisBaseUrl: "https://iris.example", sourceDomain: 6, destinationDomain: 25, requestedReceive: 100_000n, minFinalityThreshold: 1000, fetchImpl: fetchImpl as typeof fetch }),
    /circle_fast_allowance_insufficient/,
  );
});

test("Fast quote checks allowance and preserves exact receive", async () => {
  const requests: string[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    requests.push(String(url));
    return String(url).includes("/allowance")
      ? new Response(JSON.stringify({ allowance: "1000" }))
      : new Response(JSON.stringify([{ finalityThreshold: 1000, minimumFee: 1 }]));
  };
  const quote = await quoteCircleExactNet({ irisBaseUrl: "https://iris.example", sourceDomain: 5, destinationDomain: 25, requestedReceive: 100_000n, minFinalityThreshold: 1000, fetchImpl: fetchImpl as typeof fetch });
  assert.ok(quote.grossDebit - quote.maxFee >= 100_000n);
  assert.equal(requests.some((url) => url.endsWith("/v2/fastBurn/USDC/allowance")), true);
});
