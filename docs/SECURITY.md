# Wotta mainnet security and trust

This document describes the implemented direct CCTP and Starknet-native escrow/inbox paths. No Wotta mainnet escrow contract or public-funds route is currently verified or live. This is not an audit report.

## On-chain guarantees

- The Starknet router `settle` path calls Circle `receive_message`, measures the USDC balance delta, and funds only the configured denomination.
- Bindings checked on-chain include destination domain 25, Circle token-messenger recipient, mint recipient = router, destination caller = router, pool router/USDC/denomination/privacy pool, admitted source domain, and pause.
- `processed(intent_id)` / `INTENT_USED` prevent double funding of the same hook intent.
- Escrow pools enforce router-only CCTP funding, one-time claim, expiry, and collateralization.
- `settle` and public refund-after-expiry are **permissionless**. The Wotta relayer is not an authorization boundary.

Cairo does **not** decode Circle maxFee, executed fee, finality, or burn token. Those bindings are worker-side (`validateSettlement`).

## Worker checks

- Iris attestation is required before the relayer submits `settle`.
- `validateSettlement` binds source domain, destination domain, router, EVM token messenger and burn token, hook intent/pool/denomination/claim/refund/expiry/manifest, and signed quote amount/fees/finality.
- Quotes enforce pilot per-tx caps and `PILOT_PAUSED_ROUTES`.
- Relayer `estimateInvokeFee` runs before `execute`. If the intent is already `processed` on-chain, the relayer skips send and walks workflow state.
- Indexer projections (`funded` / `claimed` / `refunded`) walk the existing intent transition table; they do not jump illegal edges.

## Inherited assumptions

- **Circle CCTP / Iris:** message authenticity, attestation, mint amount, and Fast vs Standard finality.
- **Ready / STRK20:** private-balance cryptography and viewing-key handling on the client.
- **Database / identity:** Supabase auth, encrypted notes, and handle/email uniqueness. On `SN_MAIN`, notes and claims open only when the verified escrow/privacy manifest, indexer, and explicit route-admission gates all pass.
- **RPC operators:** primary and fallback Starknet RPCs; Base/Solana RPCs when those routes are admitted.

## Public metadata leakage

Direct Base and Solana sends do **not** hide:

- source wallet
- source amount
- CCTP burn transaction
- fees
- timing

Starknet-native sends likewise expose the sender wallet, fixed denomination, escrow deposit, gas, and timing. The encrypted inbox protects delivery contents; the later STRK20 claim/private activity has the privacy properties of Ready/STRK20. Neither path is anonymity.

Wotta is not a mixer and must not be marketed as one.

## Known limitations

- The relayer is a **liveness helper**. Anyone with the Iris message can call `settle` and pay STRK.
- Mainnet starts with workers and admissions off. The Starknet escrow-inbox route cannot enable without its indexer; CCTP routes additionally require the relayer and route-specific evidence.
- Worker lease is 30 seconds without heartbeat (possible overlapping executors). Idempotency relies on `processed` + destination tx hash, not the lease.
- A crash between `execute` and persisting `destination_tx_hash` can retry; on-chain `INTENT_USED` prevents double mint.
- Quote JWTs last 120 seconds and cannot be re-issued on the same intent (`signQuote` only from `draft`). Cancel is allowed only before a source tx hash exists.

## Incident and disclosure

Do not invent a vendor. Record a security contact here before treating this file as a launch artifact.

Contact: **UNSET — product owner must fill before a public mainnet invitation.**
