import { afterEach, describe, expect, it } from "vitest";
import {
  beginNetworkOperation,
  prepareNetworkSwitch,
  resetNetworkOperationsForTests,
} from "./network-operations";

afterEach(() => resetNetworkOperationsForTests());

describe("network operation isolation", () => {
  it("aborts cancelable reads before a network switch", () => {
    const operation = beginNetworkOperation("testnet");
    expect(operation.signal.aborted).toBe(false);
    expect(prepareNetworkSwitch().allowed).toBe(true);
    expect(operation.signal.aborted).toBe(true);
  });

  it("blocks a switch while an irreversible wallet request is open", () => {
    const operation = beginNetworkOperation("testnet", { blocksNetworkSwitch: true });
    expect(prepareNetworkSwitch().allowed).toBe(false);
    expect(operation.signal.aborted).toBe(false);
    operation.finish();
    expect(prepareNetworkSwitch().allowed).toBe(true);
  });
});
