# FUTURE — Batch Hook V2 (research only)

**Not a production codec. Not imported by `packages/shared`, `apps/api`, or `contracts/src`.** Designing the version is allowed; activating it is not.

## Recommended envelope

```text
BatchHookV2 {
  version,
  batchId,
  sourceDomain,
  allocationRoot,
  claimCount,
  expiresAt,
  manifestVersion
}
```

**OPEN:** exact byte layout, hash function, field widths, and tree construction. Do not invent fixtures until those are decided and recorded.

## Required properties if ever approved

- Base and Solana use **separate** batches (one CCTP burn, one source domain).
- The source batch commits the exact destination allocation set.
- No allocation is claimable before destination verifies the commitment and accounting.
- Accounting uses actual net receipt:

```text
sum(recipient allocations)
+ sum(destination refunds)
+ protocol allocation, if any
= burnAmount - feeExecuted
```

- Overflow-safe arithmetic.
- Multiple concurrent epochs, or a proof that one stuck epoch cannot block deposits.
- Pre-burn withdrawal and post-burn recovery are separate paths.
- A failed keeper must not strand the batch.
- Hook size and Starknet calldata/resource costs must be **measured**.

Do not put `ClaimId[]` in hook data. If batching is approved later, use a commitment (`allocationRoot`), not a list.
