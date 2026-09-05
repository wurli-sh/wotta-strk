# Product route review — 2026-09-05

Scope: Starknet public USDC / Base CCTP / Solana CCTP → Wotta escrow → encrypted Inbox delivery → Ready shielded USDC claim. Mainnet denominations: 0.1 and 1 USDC.

## Live observations (read-only)

| Check | Observation |
| --- | --- |
| Local API `http://localhost:8788` | Expected manifest `6e53072016f96907da1a2acc0311f5d0339e7df2ee681516ec94c7926066bf08` (re-verified 2026-09-05 for unpaused router + Base/Solana domains); Base, Solana, and `starknet-private` enabled; indexer and relayer enabled |
| Local relayer health | 0 queued, 0 failed, STRK alert false at check time |
| Mainnet router | Unpaused; source domains 6 (Base) and 5 (Solana) admitted |
| Both approved escrows | Deployed class hashes match the manifest; USDC and privacy-pool getters match the configured Mainnet addresses |
| Source RPCs | Base backend returns chain 8453; Solana backend and browser endpoints return the Mainnet genesis hash |
| Base live flow | Database records one claimed Base intent; its claim receipt is SUCCEEDED / ACCEPTED_ON_L1 |
| Starknet-native and Solana live flows | No completed Mainnet intents for these routes in the connected database; this review did not send new transactions |
| Hosted API | After an initial timeout, responds with old manifest `614ee597b54234b40b5bb56548cfeee28352ce4cce45988b73c16e5fc226fcea`, no router, no escrows, both workers off; deployment alignment check fails |

Verified Base claim: [Starkscan transaction](https://starkscan.co/tx/0x5435c965bdef576131bce2ea90f4e57c24d7e21fd5938e05b811a1da7f89b33?network=mainnet). The receipt was queried directly through the configured Starknet RPC. No recipient identifiers, claim secrets, private keys, or RPC credentials are retained here.

## Patches

- Persist a source hash immediately after wallet broadcast, before waiting on source confirmation. Base, Solana, and Starknet deposits all use this callback. API registration retries use the same idempotency key and bounded request timeouts; persistent failure preserves the transaction hash and intent ID in the recovery error.
- Make source registration retryable after a partial database write. A retry can create a missing relayer job without resetting an existing job. Late Starknet registration preserves a funded/claimed/refunded projection instead of failing or rewinding it.
- Reject finalized but reverted Ready private transactions and relayer settlement receipts. Reverted settlement hashes are cleared for retry and the intent enters recoverable failure.
- Recoverable relayer jobs re-enter attestation-ready settlement; a missing destination hash alone no longer advances an intent to funded. Already indexed settlements/claims complete queued jobs without another settlement.
- Recheck the Base wallet account and network immediately before the burn.
- Sender polling recognizes a claim completed while it was waiting. Recovery text no longer incorrectly diagnoses every failure as a Sepolia STRK shortage. Submitted hashes remain visible through an explorer link after failure; the Ready unlock control is hidden after a known broadcast and no longer asserts that nothing was sent.

Solana account ordering was compared with [Circle's V2 deposit implementation](https://github.com/circlefin/solana-cctp-contracts/blob/master/programs/v2/token-messenger-minter-v2/src/token_messenger_v2/instructions/deposit_for_burn.rs). Existing packet-size and instruction-layout checks pass; new execution coverage exercises Mainnet plan construction, partial signing, and signature publication before a confirmation failure.

## Validation and remaining deployment work

`pnpm check` passed: lint, type checks, 200 application tests (shared 18, crypto 1, adapters 12, wallet smoke 32, API 64, web 73), and production builds. `pnpm test:contracts` passed: 29 Cairo tests and 5 contract preflight tests. `git diff --check` passed. The build emits existing dependency/deprecation and bundle-size warnings.

These are automated implementation checks and read-only live observations, not newly signed Mainnet smoke evidence. No admission evidence files were fabricated. Manifest verification notes and hash were refreshed on 2026-09-05 after aligning `contracts/scripts/verify.ts` with the live unpaused / Base+Solana-admitted router posture.

The hosted API requires a release of the current code/manifest and the intended production worker configuration before it can serve these routes. Re-run `pnpm deploy:check-mainnet` after that release. Local admission and working Base history do not establish hosted availability or completed live Starknet-native/Solana claims.
