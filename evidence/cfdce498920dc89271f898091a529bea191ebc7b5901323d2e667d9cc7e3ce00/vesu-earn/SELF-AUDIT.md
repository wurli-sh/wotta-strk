# RC.2 anonymizer self-audit

Scope: upstream commit `9bfeb8dd35565a2915a0617dff3f649bd5bb891a`,
package `vesu_lending_anonymizer`, plus Wotta action/runtime/receipt integration.

## Result

No release-blocking implementation defect was found in the pinned contract.
Seven Cairo tests pass, including input validation, insufficient balances,
non-1:1 exact-share redemption, zero output, overflow, and pre-existing balance
deltas. Thirty-six Wotta Vesu tests pass across action construction, admission,
runtime drift, valuation, market parsing, ledger behavior, and adversarial
receipt fixtures.

## Trust boundaries

- The contract is stateless and intentionally accepts arbitrary token/vToken
  addresses. Wotta must pin the exact tuple before every write.
- Any tokens accidentally sent directly to this generic contract are not
  recoverable/admin-owned and may be consumed by another caller. Wotta verifies
  zero USDC/vUSDC residue at the transaction block and must never use the
  anonymizer as custody.
- The output allowance is granted to the calling privacy pool and is consumed
  atomically by the pool. A direct call is not a supported Wotta flow.
- Vesu and Ready behavior still require a real wallet smoke. Offline fixtures
  and a successful deployment do not substitute for that evidence.

This is a maintainer self-review. Independent REVIEW.md is no longer required by
`pnpm check:vesu-earn`; admission uses source parity + Ready smoke.

