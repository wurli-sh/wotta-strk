/**
 * Process-wide mutual exclusion for Earn Ready writes.
 *
 * React `busy` state alone cannot stop a double-submit: two click/submit
 * handlers can both observe `busy === false` before either re-render lands,
 * which queues two `strk20InvokeTransaction` prompts in Ready. A component
 * `useRef` gate also fails across EarnPanel remounts, so this lives on
 * `globalThis` for the tab lifetime.
 */
export type EarnWriteGate = {
  tryBegin: () => boolean;
  end: () => void;
};

type EarnWriteRuntime = {
  version: number;
  active: boolean;
  handledTxHashes: Set<string>;
};

declare global {
  // Shared across Account remounts / HMR within the same tab.
  var __wottaEarnWriteRuntime: EarnWriteRuntime | undefined;
}

const EARN_WRITE_RUNTIME_VERSION = 1;

function earnWriteRuntime(): EarnWriteRuntime {
  const existing = globalThis.__wottaEarnWriteRuntime;
  if (existing?.version === EARN_WRITE_RUNTIME_VERSION) return existing;
  return (globalThis.__wottaEarnWriteRuntime = {
    version: EARN_WRITE_RUNTIME_VERSION,
    active: false,
    handledTxHashes: new Set(),
  });
}

export function createEarnWriteGate(): EarnWriteGate {
  return {
    tryBegin() {
      const runtime = earnWriteRuntime();
      if (runtime.active) return false;
      runtime.active = true;
      return true;
    },
    end() {
      earnWriteRuntime().active = false;
    },
  };
}

/** Shared gate for Earn deposit/redeem/reveal in this browser tab. */
export function getEarnWriteGate(): EarnWriteGate {
  return createEarnWriteGate();
}

/** Claim a successful earn tx hash once (toast + local ledger). */
export function claimEarnTxHandled(transactionHash: string): boolean {
  const runtime = earnWriteRuntime();
  const key = transactionHash.toLowerCase();
  if (runtime.handledTxHashes.has(key)) return false;
  runtime.handledTxHashes.add(key);
  return true;
}

/** Test helper — clears tab-scoped earn write state. */
export function resetEarnWriteGateForTests(): void {
  globalThis.__wottaEarnWriteRuntime = {
    version: EARN_WRITE_RUNTIME_VERSION,
    active: false,
    handledTxHashes: new Set(),
  };
}
