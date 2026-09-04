# Intent recovery

Every nonterminal `INTENT_STATES` value must have an automated retry, user action, or documented incident path. Writers walk **allowed edges only** (`pathToward` in `apps/api/src/intents/recovery.ts`).

| State | Timeout | Retry owner | User action |
| --- | --- | --- | --- |
| `draft` | none | user | Create quote, or `POST /v1/intents/:id/cancel` |
| `quoted` | quote JWT 120s | user | Submit burn while JWT is valid, or cancel (`source_tx_hash` must be null). New quote requires a new intent. |
| `source_submitted` | Iris wait (backoff to 120s) | relayer | Wait; `recoveryHint=awaiting_attestation` |
| `source_confirmed` | Iris complete | relayer | Wait |
| `attestation_ready` | 15 min then self-settle CTA | relayer or any settler | Iris URL + permissionless `settle`; relayer skips if `processed` |
| `destination_submitted` | L2 confirmation + indexer | relayer / indexer | Same as above; catch-up from `onchain_tx_hash` |
| `funded` | escrow `expires_at` | recipient | Claim on-chain. Mainnet notes/inbox open only behind the verified escrow/privacy/indexer/admission gate. |
| `delivered` | escrow `expires_at` | recipient | Claim |
| `claimable` | escrow `expires_at` | recipient | Claim |
| `expired` | — | anyone after expiry | Public refund path |
| `refundable` | — | anyone / recipient | Complete refund; `POST /v1/intents/:id/refund-observed` if indexer already `refunded` |
| `failed_recoverable` | — | ops | Fund STRK, leave `relayer_jobs.attempts` intact, keep job `queued` |
| `claimed` / `refunded` / `completed` / `failed_terminal` | — | — | Terminal |

Indexer mapping:

- `onchain_state=funded` → walk to `funded` (`source_submitted` → `source_confirmed` → `funded`)
- `onchain_state=claimed` → walk to `claimed` (`funded` → `claimable` → `claimed`)
- `onchain_state=refunded` → walk to `refunded` (`funded` → `expired` → `refundable` → `refunded`)
- funded rows past `expires_at` → walk to `refundable`

`GET /v1/intents/:id` includes `recoveryHint`: `awaiting_attestation` | `self_settle` | `awaiting_claim` | `awaiting_refund` | `failed_recoverable` | `none`. Raw `relayer_jobs.last_error` is never returned to clients.
