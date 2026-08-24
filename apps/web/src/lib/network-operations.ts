import { readNetworkMode, type NetworkMode } from "@/lib/network-mode";

type ActiveOperation = {
  controller: AbortController;
  blocksNetworkSwitch: boolean;
};

const activeOperations = new Set<ActiveOperation>();

export type NetworkOperation = {
  signal: AbortSignal;
  assertActive: () => void;
  cancel: () => void;
  finish: () => void;
};

export function beginNetworkOperation(
  mode: NetworkMode,
  options: { blocksNetworkSwitch?: boolean } = {},
): NetworkOperation {
  const operation: ActiveOperation = {
    controller: new AbortController(),
    blocksNetworkSwitch: options.blocksNetworkSwitch ?? false,
  };
  activeOperations.add(operation);
  const assertActive = () => {
    if (operation.controller.signal.aborted || readNetworkMode() !== mode) {
      throw new DOMException("Network mode changed", "AbortError");
    }
  };
  return {
    signal: operation.controller.signal,
    assertActive,
    cancel: () => {
      operation.controller.abort();
      activeOperations.delete(operation);
    },
    finish: () => activeOperations.delete(operation),
  };
}

/** Cancel reads/lookups. Wallet approvals cannot be revoked once shown. */
export function prepareNetworkSwitch(): { allowed: boolean } {
  if ([...activeOperations].some((operation) => operation.blocksNetworkSwitch)) {
    return { allowed: false };
  }
  for (const operation of activeOperations) operation.controller.abort();
  activeOperations.clear();
  return { allowed: true };
}

export function resetNetworkOperationsForTests(): void {
  for (const operation of activeOperations) operation.controller.abort();
  activeOperations.clear();
}
