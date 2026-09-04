# Relayer runbook

The Wotta relayer sponsors Starknet gas for `settle`. It cannot divert funds. Correctness is on-chain + Iris + `validateSettlement`.

## Dependencies

- Funded STRK on `STARKNET_RELAYER_ADDRESS` (pre-burn threshold `STARKNET_RELAYER_ALERT_BALANCE_WEI`, default 15 STRK)
- Circle Iris (`CIRCLE_IRIS_BASE_URL`)
- Primary `STARKNET_RPC_URL` and distinct-hostname `STARKNET_FALLBACK_RPC_URL` when workers run on mainnet
- Indexer + relayer flags together on mainnet (`assertMainnetWorkerReadiness`)

## Failure modes

| Symptom | Action |
| --- | --- |
| `strkAlert` true / `failed_recoverable` | Fund relayer STRK. Do not reset `relayer_jobs.attempts`. Keep status `queued`. |
| Iris 429 | Shared cooldown; attempts are not consumed while waiting. |
| Job `attempts >= 10` | Terminal `failed`. Inspect `last_error` (service role). User can still `settle` with Iris bytes. |
| Already burned, worker down | User: Circle Iris message URL from Send/Inbox. Call router `settle`. Indexer walks workflow when it sees `RouterFunded`. |
| After expiry | Permissionless `refund_public` (public funding). Then `POST /v1/intents/:id/refund-observed` if the row is still mid-pipeline. |

## Self-settle

After 15 minutes in `attestation_ready` / `destination_submitted`, the product shows an Iris link. The user (or any helper) submits `message` + `attestation` to `settle`. Do not accept client-supplied attestation blobs on the API.
