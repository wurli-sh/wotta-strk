# Vesu Earn go/no-go — 2026-09-06

Decision: **source/verification tooling GO; deployment and Mainnet writes NO-GO**.

The pinned RC.2 source reproducibly builds to the manifest Sierra and CASM
hashes. Offline receipt fixtures prove the full mechanism: private-pool
withdrawal, pinned anonymizer invocation, Vesu deposit/redeem actors and u256
amounts, open-note output, and zero anonymizer residue at the receipt block.
The UI records its local Earn ledger only after this verification passes.

Remaining blockers are deliberately machine-enforced: independent review;
Mainnet declaration/deployment receipts and address; and a Ready 0.1-USDC
deposit, private vUSDC discovery, redeem, and private USDC rediscovery smoke.

Keep `vesuEarn.status` as `pending`. Run `pnpm check:vesu-anonymizer-source`
before declaration, and accept `verified` only when `pnpm check:vesu-earn`
prints `admit verified`.
