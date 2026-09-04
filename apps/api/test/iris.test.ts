import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../src/config.ts";
import {
  fetchAttestationWithBackoff,
  resetIrisPollingStateForTest,
} from "../src/relayer/iris.ts";

const config = {
  env: { CIRCLE_IRIS_BASE_URL: "https://iris.example" },
} as Config;

test.beforeEach(() => resetIrisPollingStateForTest());

test("Iris polling deduplicates concurrent requests and caches complete material", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    await Promise.resolve();
    return new Response(JSON.stringify({
      messages: [{ message: "0x01", attestation: "0x02", status: "complete" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const [first, second] = await Promise.all([
    fetchAttestationWithBackoff(config, 6, "0xabc", fetchImpl),
    fetchAttestationWithBackoff(config, 6, "0xabc", fetchImpl),
  ]);
  const third = await fetchAttestationWithBackoff(config, 6, "0xabc", fetchImpl);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first, third);
});

test("Iris 429 starts a shared cooldown instead of consuming job attempts", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response("", { status: 429, headers: { "retry-after": "60" } });
  }) as typeof fetch;

  assert.equal(await fetchAttestationWithBackoff(config, 6, "0xabc", fetchImpl), null);
  assert.equal(await fetchAttestationWithBackoff(config, 5, "0xdef", fetchImpl), null);
  assert.equal(calls, 1);
});
