# Phase 1 Audit — 20 August 2026

> **21 August Sepolia update:** the earlier router/deployment blockers below
> describe the pre-deployment audit snapshot. `deployments/sepolia.json` now
> records a getter-verified Circle-bound CCTP router, four fixed-denomination
> escrows, the compatible direct privacy pool, and the direct private escrow.
> The Cairo suite passes and the live indexer has ingested canonical escrow
> events. Hard Gate 1 still correctly fails until an actual Ready session is
> exported/materialized; mainnet remains outside the current testnet scope.

## Scope

Reviewed Cairo escrow/router code, mock tests, shared codecs, wallet-smoke application,
deployment scripts, and the deployment manifest.

## Fixed findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | A zero/reused private refund commitment could overwrite the refund-to-claim map. | Escrow now rejects zero claim/refund commitments and an already-bound refund commitment. |
| High | Claim/refund actions accepted zero secrets and zero note IDs. | Escrow rejects both values before deriving or returning an `OpenNoteDeposit`. |
| High | Worker leases used an unconditional upsert, allowing concurrent workers to believe they held the same lease. | Phase 2 now uses an atomic, service-only lease RPC. |
| High | The pending-claim RPC was `security definer` but still executable by public roles. | Explicitly revoked public/anon/authenticated execution and granted only `service_role`. |
| High | Wallet-link challenges did not bind the exact signed typed-data payload; a UUID was typed as a felt. | The challenge is now hashed, compared on consumption, and defines `profile` as a SNIP-12 string. |

## Release blockers that remain

1. `WottaCctpRouter` uses a local felt-span mock codec, while Circle's actual Starknet
   `MessageTransmitterV2.receive_message` uses a `ByteArray` protocol message and dispatches
   to the official TokenMessengerMinter handler. The current router is not deployable for real
   CCTP. CCTP routes remain disabled.
2. There is no declared/deployed router or four escrow pools in `deployments/mainnet.json`, and
   no retained Ready/STRK20 stateful-helper evidence. Hard Gate 1 is therefore not passed.
3. The existing Cairo tests use `MockErc20` and `MockCctpMessenger`; they demonstrate local
   behavior but are not mainnet/Circle/STRK20 capability evidence.

## Sepolia deployment record

The direct/private escrow path is deployed to Sepolia using the official Sepolia USDC and a
separately deployed STRK20 privacy pool. The four Wotta fixed-denomination pools are recorded
with transaction hashes, block numbers, constructor calldata, and RPC getter checks in
`deployments/sepolia.json`. Each was deployed with a zero router address, so it is suitable only
for direct/public funding and STRK20 private flows; it cannot process CCTP.

The Sepolia manifest remains deliberately unverified at the application-route level. It is not
evidence for the Phase 1 hard gate because no live Ready wallet proof/discovery flow has been
recorded, and it does not remove the Circle CCTP blocker.

## Conclusion

Public and private escrow paths are safer after the fixes, but neither Phase 1 nor the CCTP
portion of Phase 2 is release-ready. The backend is intentionally fail-closed until these
blockers are resolved with official CCTP interfaces, deployments, and live evidence.
