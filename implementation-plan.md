# Wotta — Binding Three-Phase Implementation Plan

**Status:** implementation-ready specification  
**Prepared and source-validated:** 17 August 2026  
**Product definition:** [`wotta-idea.md`](./wotta-idea.md)  
**Hackathon requirements:** [`strk-hk.md`](./strk-hk.md)  
**Local code donors:** [`../swoop`](../swoop) and [`../sable`](../sable)  
**Target:** Starknet mainnet (`SN_MAIN`), native six-decimal USDC

## 0. How to use this plan

This is the implementation contract for Wotta. Work is divided into exactly three sequential phases:

1. contracts and STRK20 capability proof;
2. backend, identity, delivery, CCTP, and indexing; and
3. the Swoop frontend port and complete browser flows.

Each phase has named work packages, file ownership, tests, retained evidence, and a hard gate. A later phase may be scaffolded for shared types, but product work does not begin until the prior gate passes. A gate requires reproducible commands and retained artifacts; screenshots, mocks, and undecoded hashes do not pass.

### Validation labels and engineering rules

- **Verified:** supported by official sources or working Sable/Swoop code.
- **Implementation decision:** behavior Wotta will implement and test.
- **Capability gate:** an upstream interface exists, but the exact Wotta path must pass a live spike before it is enabled.
- “Source-validated” is not a security audit. Wotta's escrow helper is new financial code.
- Use pnpm workspaces, strict TypeScript, and authored files below 300 physical lines. Generated ABIs/OpenAPI/artifacts/manifests/lockfiles are excluded by exact path.
- A protocol change updates Cairo and TypeScript codecs, Zod schemas, fixtures, manifests, API types, tests, and privacy docs together.
- USDC is `bigint` in TypeScript, decimal strings in JSON/Postgres, `u256` at ERC-20 boundaries, and checked `u128` for `OpenNoteDeposit`.
- Never expose a wallet/route in the UI without a manifest, runtime capability check, and retained live smoke.

## 1. Validated facts and locked decisions

### What is available

| Capability | Validated availability | Wotta decision |
|---|---|---|
| STRK20 pool | Live on mainnet at `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | Verify and pin in a manifest; never scatter addresses through code. |
| Wallet API | Spec `0.10.3` exposes STRK20 invoke/prepare/balances plus deposit, withdraw, transfer, and invoke actions | Use it in the web app; Wotta never manages viewing keys, notes, or proofs. |
| Browser library | STRK20 landed in `starknet.js` 10.4; upstream currently pins 10.5 | Pin `starknet@10.5.0`, never `latest`. |
| Wallet | Ready extension is the current developer start path; Xverse support is rolling out | Enable Ready first and feature-detect methods. Other wallets require the same smoke suite. |
| Privacy SDK | Open-source, current source `0.14.3-rc.5`, Node 24 | Not used in the normal dapp path; test/tooling only when Wallet API cannot exercise a fixture. |
| Anonymizers | Official repo ships the `privacy_invoke`/`OpenNoteDeposit` interface and production helpers | Build Wotta escrow as an app-specific anonymizer; do not rebuild STRK20 cryptography. |
| Escrow pattern | STRK20 by Example documents secret-backed stateful escrow | Explicitly unofficial/unaudited. Use as a pattern, then add denominations, TTL, refunds, CCTP, and full review. |
| CCTP | Starknet is Circle domain `25`; CCTP contracts are live | Use CCTP V2 with a Wotta Starknet destination router/relayer. |
| Forwarding Service | Starknet is not a supported Forwarding Service destination | Wotta fetches Iris attestations and submits destination `receive_message`. |
| Native USDC | Mainnet `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` | Verify from Circle at deploy and pin. |
| Auth | Supabase supports Google and X OAuth 2.0; X provider ID is `x` | Use PKCE and only verified provider identities. |
| TTL jobs | Supabase Cron uses `pg_cron`; Sable has a seven-day pending-note flow | Cron projects status; contract time is authoritative for funds. |

### Locked product behavior

| Decision | Binding choice |
|---|---|
| Settlement | Starknet mainnet |
| Denominations | 1, 10, 50, 100 USDC; one immutable Wotta escrow instance per denomination |
| Privacy | Existing unified STRK20 pool; Wotta does not create a second note pool |
| Identity | Google email and X username/provider subject through Supabase |
| Wallet binding | One active Starknet address per Wotta profile |
| Standard payment | Public Starknet deposit or CCTP arrival funds escrow; recipient accepts into an STRK20 open note |
| Private/registered | Direct native STRK20 private transfer; inbox receives an encrypted receipt |
| Private/unregistered | STRK20 invokes Wotta escrow; recipient later accepts with a claim secret |
| TTL | Exactly `issuedAt + 604800` seconds in signed payload, database, contract, and UI |
| Refund | Public funding → pre-bound Starknet address; private funding → STRK20 open note using a separate refund secret |
| Gas | Wallet API/paymaster for private actions; Wotta relays destination CCTP settlement only |
| Truth | Canonical indexed evidence, never optimistic browser/backend state |
| Admin | No seizure, recipient override, arbitrary sweep, or admin claim |

### Privacy matrix

| Flow | Public | Private |
|---|---|---|
| Standard → escrow → recipient note | Source burn/mint or Starknet transfer, denomination, timing, helper claim amount | Recipient note owner and later STRK20 activity |
| Private registered → registered | Protocol metadata | Sender, recipient, token, amount, balances |
| Private sender → unregistered escrow | Helper address, fixed amount, deposit/claim timing | Sender identity and recipient note owner |

`privacy_invoke` exposes helper actions and amounts. Full transfer privacy is claimed only for direct registered-to-registered STRK20 transfers. Fixed denominations reduce uniqueness; they do not cryptographically hide escrow amount/timing.

## 2. Architecture and flows

```text
Sender browser
  ├── Google/X session + signed recipient descriptor
  ├── local claim/refund secret generation
  ├── signed quote + reviewed route manifest
  └── source action
       ├── Starknet USDC → WottaEscrowPool
       ├── EVM/Solana/Stellar CCTP → WottaCctpRouter → WottaEscrowPool
       ├── STRK20 invoke → WottaEscrowPool (unregistered)
       └── STRK20 transfer → registered recipient
                           │
Wotta API + Supabase      │
  ├── verified identities/wallet bindings
  ├── encrypted inbox + KMS-sealed pending delivery
  ├── intents, indexers, Iris poller, destination relayer
                           │
Recipient browser         ▼
  ├── register within seven days if needed
  ├── decrypt claim locally
  └── Wallet API: transfer OPEN + escrow invoke → private USDC note
```

### Standard registered recipient

1. Recipient signs in, binds a Starknet wallet with a one-use SNIP-12 challenge, and publishes an X25519 inbox public key.
2. Sender resolves the exact identity and receives a short-lived signed descriptor containing Starknet address, inbox key, issue/expiry, and nonce.
3. Browser generates a nonzero 31-byte claim secret and domain-separated claim hash for the selected pool.
4. API signs an exact-net quote bound to intent, source account, denomination pool, claim hash, refund address, seven-day expiry, hook hash, and manifest hash.
5. Sender funds locally or through CCTP. Browser posts an encrypted inbox envelope after source submission.
6. Indexer verifies funding before marking it claimable.
7. Recipient's wallet creates an open USDC note and invokes `Claim` atomically.
8. Contract validates secret, state, and expiry; marks claimed; approves STRK20 for exactly the denomination; returns one `OpenNoteDeposit`.
9. UI completes only after canonical `Claimed` evidence.

### Unregistered recipient

1. Resolution returns `unregistered`; no wallet address is invented.
2. Browser seals claim material to Wotta's pending-delivery public key.
3. Supabase stores ciphertext plus `HMAC-SHA256(IDENTITY_LOOKUP_KEY, provider + ":" + normalized_identifier)`, never plaintext claim secret or lookup identity.
4. Funds enter escrow with the same seven-day timestamp.
5. On signup, backend derives verified identifiers from `auth.identities`, locks matches with `FOR UPDATE SKIP LOCKED`, decrypts via separate KMS, re-encrypts to the user's inbox key, inserts idempotently, and marks delivered.
6. Recipient accepts through Wallet API. After expiry, claim rejects and the correct refund path becomes available.

The pending-delivery runtime/KMS can access a claim secret during re-encryption; a database dump alone cannot. This flow is not trustless against the delivery service and must be documented as such.

### Private modes

- **Registered:** `wallet_strk20InvokeTransaction([{type:"transfer", token:USDC, amount, recipient}])`; encrypted receipt only, no Wotta escrow.
- **Unregistered:** invoke the denomination escrow with claim/refund commitments and expiry. The helper parks the fixed amount and later returns an open note on claim/refund. Sender identity is hidden; amount/timing is public.

### Trust boundaries

- Wallet owns viewing keys, notes, proof creation, signatures, and private balances.
- Browser owns secret generation and registered-recipient encryption.
- API resolves identities and releases KMS-sealed pending claims but cannot alter funded commitments/refund destinations.
- CCTP relayer controls liveness only; message/contract bindings prevent redirection.
- Indexer is a rebuildable read model and cannot authorize movement.
- Supabase secret keys and pending-delivery private key never enter the browser.

## 3. Stack and exact dependency baseline

### Swoop baseline

- Node `>=24`, pnpm `10.33.0`, TypeScript `5.8.3` strict.
- Next `15.5.21`, React `19.0.0`, Tailwind `4.0.17`, Framer Motion `12.40.0`, TanStack Query `5.69.0`, Sonner `2.0.3`, Playwright `1.55.1`.
- Fastify `5.8.5`, Zod `3.25.76`, Pino `9.6.0`, `jose` `5.10.0`, Supabase JS/SSR `2.49.x`/`0.6.1`, Upstash Redis `1.34.5`, TweetNaCl `1.0.3`.
- Preserve reviewed Swoop overrides, then remove Nox-only overrides after imports prove unused.

### Starknet/privacy baseline

- `starknet@10.5.0`; Wallet API schema `v0.10.3`.
- Scarb `2.17.0`, Starknet Foundry `0.59.0`, Cairo edition `2024_07`, OpenZeppelin Cairo `3.0.0`.
- Contracts initially pin `starkware-libs/starknet-privacy` tag `PRIVACY-0.14.3-RC.0` (`fe52334…`), identified by upstream for the live contract row; import only `privacy::objects::OpenNoteDeposit`.
- If low-level SDK tooling is needed, pin a complete compatible SDK/prover/discovery row. Never mix revisions.
- `viem` for EVM sources, existing Swoop Solana/Stellar dependencies, `starknet` for Starknet, native `fetch` for Circle APIs.

### Mandatory preflight

1. Copy Swoop workspace/lock baseline and remove Nox runtime/contracts.
2. Add exact Starknet/privacy pins.
3. Compile a Ready Wallet API connection and `strk20Balances` call.
4. Compile an echo anonymizer against the pinned privacy interface.
5. Run `strk20PrepareInvoke(actions, true)` for the Wotta claim shape.
6. Record versions, hashes, wallet version, pool address/class hash, and results in `docs/dependencies.md`; freeze lockfile for the phase.

## 4. Repository and module contract

```text
wotta/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/          # JWT, provider sync, normalize, wallet challenge
│   │   │   ├── config/        # env, manifests, ABIs, route health, keystore
│   │   │   ├── db/            # service client, repositories, transactions
│   │   │   ├── delivery/      # envelopes, pending KMS, notes, notification
│   │   │   ├── evidence/      # Starknet/EVM/Solana/Stellar/CCTP decoders
│   │   │   ├── indexer/       # cursor, fetch, decode, reorg, reconcile
│   │   │   ├── intents/       # repository, reducer, transitions, idempotency
│   │   │   ├── openapi/       # generated API contract
│   │   │   ├── quotes/        # fees, exact-net, hook, sign, verify
│   │   │   ├── redis/         # rate limits, leases, nonce locks
│   │   │   ├── relayer/       # Iris poll, receive_message, retry/recovery
│   │   │   ├── resolver/      # signed descriptors
│   │   │   ├── routes/        # health/me/wallet/resolve/quotes/intents/notes
│   │   │   ├── workers/       # heartbeat, expiry projection
│   │   │   ├── server.ts
│   │   │   ├── indexer.ts
│   │   │   └── relayer.ts
│   │   └── test/
│   ├── wallet-smoke/           # minimal Ready/Wallet API capability app
│   └── web/
│       ├── e2e/
│       ├── public/{chains,manifests}/
│       └── src/
│           ├── app/            # copied Swoop routes
│           ├── components/     # copied Swoop shell and UI primitives
│           ├── features/{account,balance,claim,inbox,send}/
│           └── lib/{api,security,starknet,strk20,supabase,wallets}/
├── contracts/
│   ├── src/
│   │   ├── escrow/wotta_escrow_pool.cairo
│   │   ├── router/wotta_cctp_router.cairo
│   │   ├── interfaces/{erc20,cctp,privacy}.cairo
│   │   ├── libraries/{types,claim_hash,hook_codec,cctp_codec}.cairo
│   │   ├── mocks/
│   │   └── lib.cairo
│   ├── tests/{unit,invariant,integration}/
│   ├── scripts/{declare,deploy,verify}.ts
│   ├── Scarb.toml
│   └── package.json
├── packages/
│   ├── adapters/src/{evm,solana,stellar,starknet}/
│   ├── config/
│   ├── crypto/src/{claim,encryption,hash,pending-envelope,signature}.ts
│   └── shared/src/{abi,codecs,fixtures,manifest,schemas,state}/
├── deployments/{mainnet.json,routes.mainnet.json,local.json}
├── supabase/migrations/
├── docs/{architecture,dependencies,deployment,env,privacy,recovery,threat-model}.md
├── evidence/<manifest-hash>/<flow>/
├── pipeline/{1A-...,2A-...,3A-...}/
├── scripts/{deploy,e2e,gates,ops}/
├── strk20.json
├── .env.example
├── package.json
├── pnpm-workspace.yaml
└── implementation-plan.md
```

Each pipeline work package has `spec.md`, `changes.md`, `test-results.md`, and `review.md`.

### Exact reuse map

| Donor | Treatment |
|---|---|
| `../swoop/apps/web` | Copy all routes, components, feature splits, UI primitives, styles/assets/fonts, motion, tests, Supabase shell, and API client 1:1. |
| Swoop API `intents/indexer/relayer/evidence/quotes/routes` | Copy structure/durable patterns; replace Nox/EVM destination with Starknet/CCTP/STRK20. |
| Swoop `shared/crypto/adapters/config` | Copy boundaries/utilities; replace EVM claim schemas with Cairo-compatible types. |
| Swoop scripts/CI/evidence | Copy orchestration; replace Foundry/Nox commands. |
| Sable auth and Supabase web helpers | Port current Google/X handling, callback, session sync, identity normalization. |
| Sable `packages/db/src/notes.ts` | Port seven-day match/lock/deliver; replace plaintext `claim_fragment` with KMS ciphertext. |
| Sable `SablePool.sol` | Reference immutable denomination/exact transfer/one-time behavior only; do not port Merkle/Groth16/EVM code. |

Preserve both MIT notices. Never copy `.env`, `.git`, deployed secrets, old manifests, build artifacts, or Nox code.

## 5. Shared protocol definitions

- IDs/secrets are nonzero 31-byte random values—canonical felts without biased modulo reduction.
- Claim/refund hashes use different Poseidon tags and include `SN_MAIN` and pool address.
- Addresses use canonical felt equality. Unix seconds are `u64`.
- Payloads begin with a version and reject truncation/trailing data.
- Never log raw identity, claim/refund secret, viewing key, OAuth token, pending plaintext, or inbox plaintext.

```text
claimHash  = Poseidon("WOTTA_CLAIM_V1",  chainId, poolAddress, claimSecret)
refundHash = Poseidon("WOTTA_REFUND_V1", chainId, poolAddress, refundSecret)
```

Cairo defines the exact sequence; TypeScript consumes Cairo-generated fixtures.

### `RecipientDescriptorV1`

```text
version, descriptorId, registered, recipientProfileRef
recipientStarknetAddress? , inboxEncryptionPublicKey?
identifierLookupHash, issuedAt, validUntil, nonce, resolverSignature
```

Registered-only fields are absent for unknown users. Browser verifies signature and short expiry.

### `WottaHookV1`

```text
magic, version, intentId, denominationCode, escrowPool
claimHash, publicRefundRecipient, expiresAt, manifestVersion
```

EVM/Solana/Stellar encoders and Cairo decoder share golden bytes/mutation tests. Burn uses destination domain `25`, `mintRecipient = router`, `destinationCaller = router`.

### `RouteQuoteV1`

```text
version, quoteId, intentId, routeId, sourceAccount
denomination, requestedReceive, grossDebit, maxFee, minFinalityThreshold
escrowPool, claimHash, refundRecipient, hookHash, descriptorHash
manifestHash, issuedAt, expiresAt, coordinatorSignature
```

For CCTP, `grossDebit >= denomination + maxFee`. Router deposits exactly one denomination and returns surplus to the pre-bound Starknet refund address. Query current Circle fees; never hardcode bps.

### Intent state

```text
draft → quoted → source_submitted → source_confirmed
      → attestation_ready → destination_submitted   # CCTP only
      → funded → delivered → claimable → claimed
funded/claimable → expired → refundable → refunded
any nonterminal → failed_recoverable | failed_terminal
private direct: source_submitted → source_confirmed → delivered → completed
```

Transitions are append-only plus projected current state. All mutations require idempotency key and expected version. Browser hashes are hints; workers validate sender, route/domain, token, amount, pool/router, commitment, expiry, and canonical receipt.

## 6. Phase 1 — Contracts and STRK20 capability

**Outcome:** four fixed-denomination escrow/anonymizer instances and a CCTP router, with live proof of public/private claim/refund into STRK20.

### 1A — Wallet API/helper spike

- Build `apps/wallet-smoke`; connect Ready.
- Feature-detect invoke/prepare/balances; run mainnet-safe balance read.
- Prove direct private transfer, invoke returning an open-note deposit, stateful invoke returning empty, and later release into an open note.
- Simulate with `strk20PrepareInvoke(actions, true)` before proof/submission.
- Retain wallet/library/schema versions, actions/calldata, pool/class hash, txs, and decoded effects.

If stateful park/release does not work with the current Wallet API, stop. Do not silently switch production to a low-level/custodial path.

### 1B — Libraries/codecs

Implement Cairo `types`, domain-separated `claim_hash`, strict `hook_codec`, minimal `cctp_codec`; mirror under `packages/shared`; generate golden fixtures from Cairo; test mutation, truncation, trailing data, overflow, and wrong domain/pool.

### 1C — `WottaEscrowPool`

Declare one class and deploy four instances configured with privacy pool, native USDC, CCTP router, denomination, and chain.

Stored claim:

```text
status: NONE | FUNDED | CLAIMED | REFUNDED
fundingKind: PUBLIC_DIRECT | CCTP | PRIVATE
publicRefundRecipient, privateRefundHash, expiresAt, fundedAt
```

Entry points:

- `deposit_public(claim_hash, refund_recipient, expires_at)` transfers exact denomination.
- `fund_from_router(...)` only immutable router; exact denomination.
- `privacy_invoke(...) -> Span<OpenNoteDeposit>` only immutable STRK20 pool:
  - `PRIVATE_FUND`: validate exact pool-provided amount, create claim/refund commitments, park funds, return empty;
  - `CLAIM`: recompute hash from secret, require funded/not expired, mark claimed before approval, approve pool, return one note deposit;
  - `PRIVATE_REFUND`: recompute refund hash, require private funding/expired, mark refunded, approve pool, return one note deposit.
- `refund_public(claim_hash)` after expiry; transfers only to stored refund address.
- Views: claim, denomination, privacy pool, USDC, router.

Invariants:

- deployable denominations only `1e6/10e6/50e6/100e6`;
- fund once, terminate once; `claimed + refunded <= funded`;
- balance always covers live liabilities;
- no admin extraction/redirect/expiry shortening;
- state before external call, checked token return/balance delta;
- claim before expiry, refund at/after expiry, identically tested everywhere;
- events contain commitment/state/denomination/expiry, never identity/secret.

### 1D — `WottaCctpRouter`

The router is CCTP `mintRecipient` and `destinationCaller`. `settle(message, attestation)`:

1. strictly decodes hook before consuming attestation;
2. validates allowed source domain/version/pool;
3. atomically calls Circle `receive_message`;
4. measures native-USDC balance delta;
5. funds selected pool with exact denomination;
6. sends surplus to hook-bound refund address;
7. if valid hook is underfunded, sends all received funds to that refund address and emits `UnderfundedRefunded`;
8. uses Circle nonce protection plus processed `intentId`; and
9. emits settlement evidence.

Circle treats hooks as opaque; Wotta owns execution. Canonical source adapters must simulate encoding before irreversible burn.

### 1E — Tests/deployment

- Unit each operation/denomination/caller/error/replay/boundary/token failure.
- Fuzz secrets, expiries, hook lengths, amounts, ordering.
- Invariant reserves vs live liabilities/no double terminal state.
- Integration: public→private claim, public refund, private→claim, private→private refund, mocked CCTP→pool.
- Mainnet smoke with smallest safe amounts against real STRK20.
- Output class/instance/router addresses, constructors, deployment blocks/txs, commit/tool/ABI/class hashes, Circle/USDC/pool values, Voyager links, and `deployments/mainnet.json`.

### Hard Gate 1

- Clean-clone contract build/tests/fuzz/invariants pass.
- Ready stateful helper spike passes on real STRK20.
- Four instances/router are deployed and verified.
- Public claim, private direct transfer, and refund have decoded mainnet evidence.
- No known redirect, double claim, correct-message stranding, or liability withdrawal path remains.

## 7. Phase 2 — Backend, identity, delivery, and routes

**Outcome:** durable Google/X identity, seven-day delivery, cross-chain settlement, recovery, and chain-derived state.

### 2A — Scaffold

Copy Swoop Fastify layout, env/config, redacted logger, Redis, OpenAPI, separate server/indexer/relayer processes, shutdown, health, Docker/Render. Rename `@swoop` to `@wotta`. Startup and routes fail closed on bad env/manifest.

### 2B — OAuth and wallet binding

- Supabase SSR PKCE copied from Sable; providers exactly `google` and `x`.
- Sync Google verified email and X provider subject/canonical username from `auth.identities`; never trust typed identity as ownership proof.
- Enforce one active owner per provider+normalized identifier.
- Wallet challenge is random, one-use, five minutes, SNIP-12, and binds profile/address/chain/origin/purpose/nonce/times.
- Verify with `RpcProvider.verifyMessageInStarknet` for account-abstraction safety.
- Binding publishes X25519 inbox public key; private key stays browser-side.

### 2C — Schema/RLS

Tables:

- `profiles(id = auth.users.id, display_name, timestamps)`;
- `identities(profile_id, provider, provider_subject, normalized_identifier, verified/revoked)`;
- `wallet_bindings(profile_id, address, chain_id, inbox_pubkey, challenge_verified_at, key_version, active/revoked)`;
- `wallet_challenges(profile_id, nonce_hash, address, purpose, expires/consumed)`;
- `intents(owner, mode, delivery_kind, denomination, route, claim/refund hashes/address, expiry, state/version, tx fields, idempotency)`;
- `intent_events(intent, from/to state, evidence, payload, time)`;
- `encrypted_notes(recipient/sender, intent, ciphertext, nonce, algorithm, version, delivered)`;
- `pending_claims(sender, recipient_lookup_hash, intent, sealed_payload, key_version, expiry, delivered profile/time)`;
- `chain_events`, `indexer_cursors`, `relayer_jobs`, `worker_leases`.

Enable/force RLS everywhere. Browser sees only own profile/binding/intents/inbox/sent envelopes. Deny all browser access to pending/worker/chain internals. Backend uses a separate secret-key client unaffected by SSR cookies. Revoke broad grants; add partial unique indexes and idempotency. No plaintext secret columns.

### 2D — Resolver/delivery/TTL

- Authenticated/rate-limited `POST /v1/resolve` returns signed descriptors.
- Registered delivery: sender-side X25519 sealed box.
- Pending: dedicated rotating KMS/X25519 key; ciphertext+key version only.
- On OAuth sync, match HMAC, lock unexpired rows, re-encrypt, insert idempotently, mark delivered.
- Cron/worker projects expiry/notifications but never overrides contract time.
- Purge sealed pending payload after delivery plus short recovery window.

### 2E — Quotes, routes, relayer, indexer

| Route | Domain | Action |
|---|---:|---|
| Starknet public | 25 | USDC approval + pool deposit |
| Ethereum | 0 | CCTP V2 hook to Starknet |
| Arbitrum | 3 | CCTP V2 hook |
| Base | 6 | CCTP V2 hook |
| Solana | 5 | CCTP V2 hook instruction |
| Stellar | 27 | CCTP V2 hook operation |
| Starknet private | — | native private transfer or anonymizer invoke |

Every non-Starknet route starts disabled until a live smoke proves canonical token, source contract/program/domain, hook support, fee/finality policy, destination message, and router settlement.

Relayer validates source evidence, polls Circle `/v2/messages`, uses bounded backoff and leases/nonce serialization, submits router settlement idempotently, and cannot alter hook/claim/pool/refund.

Indexer stores block hash/cursor, handles continuation/duplicates/reorg rollback/replay, projects Wotta/router events, reconciles source→message→mint→router→escrow, and can rebuild from deployment block.

### 2F — HTTP contract

```text
GET  /v1/health              GET  /v1/routes
GET  /v1/me                  POST /v1/session/sync
POST /v1/wallet/challenge    POST /v1/wallet/link
POST /v1/resolve             POST /v1/quotes
POST /v1/intents             GET  /v1/intents/:id
POST /v1/intents/:id/source-submitted
POST /v1/intents/:id/delivery
GET  /v1/notes               POST /v1/notes/:id/delivered
POST /v1/intents/:id/refund-observed
GET  /v1/openapi.json
```

Schemas live in shared and generate OpenAPI. Enforce body limits, bearer auth for mutations, CORS allowlist, quotas, and redaction.

### Hard Gate 2

- Hosted/local Google and X login pass.
- Wallet binding passes; replay/expiry/wrong origin fail.
- Registered inbox is ciphertext-only and RLS party-scoped.
- New user receives matching unexpired pending items exactly once; expired never deliver.
- Direct Starknet and every enabled CCTP route complete without frontend with decoded evidence.
- Relayer/indexer recover after restart, duplicate job, delayed attestation, simulated reorg.
- Empty read model rebuild succeeds.

## 8. Phase 3 — Copy Swoop frontend and wire Wotta

**Outcome:** Swoop's full polished component system with Starknet/STRK20 behavior.

### 3A — Mechanical copy

Copy all of `../swoop/apps/web`: routes, components, primitives, features, helpers, assets/fonts/CSS, motion, toast/skeleton states, reducers, unit tests, and Playwright.

Preserve `/`, `/send`, `/inbox`, `/claim`, `/c`, `/account`, `/balance`, `/activity/[id]`, `/register`, `/status`, `/privacy`, `/auth/callback`; `AppChrome`, `IslandNav`, auth, send card, recipient/source/quote/progress, note cards, account/security, balance, celebration, recovery/error UI.

Rename branding/imports mechanically. First commit is copy/rename with no redesign and retained MIT notice.

### 3B — Integration seams only

- Remove Nox/wrapped-USDC/destination-wagmi code; retain EVM/Solana/Stellar modules for source chains.
- Add `lib/starknet/{connection,wallet-capabilities,typed-data}` and `lib/strk20/{actions,balance,claim,private-send}`.
- Ready is initially enabled; missing Wallet API gives an actionable failure.
- Replace free amount input with four identical-style denomination choices from signed manifest.
- Rename `ConfidentialToggle` to `PrivateModeToggle` without redesign.
- Keep Swoop reducers/orchestration split; no monolithic wallet+API+crypto component.

### 3C — Send

Standard: authenticate → denomination → enabled source → resolve identity → generate secret → verify descriptor/quote → connect source wallet → simulate → submit → retain recovery material until delivery succeeds → show indexed progress/expiry/refund.

Private: read `strk20Balances([USDC])`; registered descriptor uses private transfer; unregistered uses escrow invoke; simulate with prepare then invoke; tolerate long wallet proof UI without normal HTTP timeout; display correct flow-specific privacy wording.

### 3D — Inbox, claim, refund

- Decrypt registered/pending envelopes locally through copied unlock provider.
- Validate payload version/pool/manifest/hash/expiry/indexed funding before wallet action.
- Claim action: one `OPEN` USDC transfer to connected recipient plus invoke using `${openNoteIds[0]}`.
- Private refund uses sender refund secret/open-note path; public refund calls permissionless `refund_public` which pays only stored address.
- Duplicate clicks resume existing intent/tx and never regenerate secrets.

### 3E — Remaining screens

- Account: Google/X identities, Starknet binding, inbox key version, Wallet API capability.
- Balance: private via wallet, public via ERC-20; show shield/unshield only if wallet advertises them.
- Activity: evidence-derived timeline and explorer links for public edges.
- Status: process/worker/route readiness and safe disabled reason codes.
- Privacy: exact matrix above, selective disclosure/viewing-key note, and timing/amount correlation warning.

### 3F — E2E/release

Test Google and X registered claims; unknown signup within TTL; expired public refund; registered private direct; unregistered private claim/refund; every enabled CCTP route; wallet rejection/missing API/long proof/stale quote/wrong network/retry/restart/duplicate/refresh; mobile/desktop accessibility/reduced motion; CSP/fragment tests proving secrets never enter requests, referrers, analytics, logs, or SSR.

### Hard Gate 3

- Every Swoop route/component exists and is Wotta-branded.
- Standard/private mainnet flows have retained evidence.
- Registered/unregistered/expired/refund/recovery mobile+desktop E2Es pass.
- Privacy copy matches behavior.
- Demo URL/video, contracts, and at least three STRK20-touching mainnet txs are in `strk20.json`.

## 9. Manifests, env, commands, CI, evidence

`mainnet.json` stores chain/domain, USDC, STRK20 pool/class, Circle contracts, router, four pool addresses/denominations/class, deployment blocks/txs, ABI/tool/source hashes, resolver key, manifest hash. Each route stores route/family/network, chain/passphrase, domain, USDC, messenger/program, finality/fee policy, explorer/RPC env names, hook limit, enabled/verified status, and evidence path.

Public web env:

```text
NEXT_PUBLIC_APP_ORIGIN
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_STARKNET_NETWORK=mainnet
NEXT_PUBLIC_DEPLOYMENT_MANIFEST_PATH
```

Backend-only:

```text
DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
STARKNET_RPC_URL, STARKNET_RELAYER_ADDRESS, STARKNET_RELAYER_KEY_OR_KEYSTORE
RESOLVER_SIGNING_KEY, IDENTITY_LOOKUP_KEY, PENDING_DELIVERY_PRIVATE_KEY
CIRCLE_IRIS_BASE_URL, EVM_RPC_<ROUTE>, SOLANA_RPC_URL, STELLAR_HORIZON_URL
RESEND_API_KEY, LOG_LEVEL, CORS_ORIGINS
```

Startup validates derived keys/addresses, rejects hosted placeholders, and redacts auth/cookies/signatures/ciphertexts/CCTP material/secrets.

Root commands:

```text
pnpm dev | dev:web | dev:api | dev:indexer | dev:relayer | dev:wallet-smoke
pnpm lint | typecheck | build | test
pnpm test:contracts | test:api | test:web | test:adapters | test:crypto | test:e2e
pnpm contracts:build | contracts:declare | deploy:mainnet | deployment:verify
pnpm manifests:check | db:migrate | openapi:generate
pnpm smoke:wallet-api | smoke:direct | smoke:private | smoke:route:<id>
pnpm reindex:mainnet | scan:secrets | check:lines | check:evidence | check
```

`pnpm check` runs clean-clone line/lint/type/build, all tests, ABI/fixture parity, manifests, secrets, OpenAPI drift, and evidence schemas. Mainnet smokes are protected manual CI jobs.

Evidence under `evidence/<manifest-hash>/<flow>/` contains manifest hash, source/destination txs, safe Circle nonce/message hash, decoded Wotta events, expected/actual base amounts, finality, tool versions, command/time, assertions—never full sensitive payloads.

## 10. Non-goals and blocking gates

Do not implement or imply: a second privacy pool; custom proof/viewing-key management; arbitrary MVP amounts; hidden CCTP/shield/unshield; amount-private helper calls; trustless pending KMS; admin fund recovery; unsupported route badges; audit/production claims; or Circle forwarding to Starknet while unsupported.

Release blockers:

1. Ready supports required methods on pinned versions.
2. Stateful custom helper parks/releases through Wallet API.
3. Cairo serialization matches live pool.
4. Each enabled CCTP source passes hook/router settlement.
5. Reserve invariants pass fuzz/invariant tests.
6. Google/X metadata supplies the verified resolver identity fields.

A failed gate disables the feature; never replace it with mocked/custodial success.

## 11. Definition of done

Wotta is complete when a Google/X user can bind Starknet, pay 1/10/50/100 USDC to an email/handle from every enabled route, and a registered or newly registered recipient can accept into STRK20 before seven days. Expired public/private payments refund only through precommitted paths. Registered shielded users can pay directly and privately. Every state is recoverable from canonical evidence, each claim terminates once, privacy copy is exact, and a clean clone produces mainnet/demo evidence.

## 12. References

### Official Starknet/STRK20

- [Privacy architecture](https://docs.starknet.io/build/starknet-privacy/architecture)
- [Transaction ordering/invariants](https://docs.starknet.io/build/starknet-privacy/transaction-flow)
- [Wallet API schema](https://github.com/starkware-libs/starknet-specs/blob/master/wallet-api/wallet_rpc.json)
- [Privacy repository/compatibility matrix](https://github.com/starkware-libs/starknet-privacy)
- [Developer launch guidance](https://www.starknet.io/blog/push-to-private/)
- [Wallet API overview](https://strk20-by-example.org/starknet-wallet-api/overview)
- [`privacy_invoke` Wallet API flow](https://strk20-by-example.org/starknet-wallet-api/private-defi)
- [Anonymizer anatomy](https://strk20-by-example.org/helpers/privacy-invoke)
- [Escrow pattern—unofficial](https://strk20-by-example.org/helpers/escrow)
- [Starknet.js WalletAccount](https://starknetjs.com/docs/guides/account/walletAccount/)

### Official Circle

- [Supported chains/domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains)
- [CCTP guide/hooks](https://developers.circle.com/cctp/references/technical-guide)
- [Starknet CCTP contracts](https://developers.circle.com/cctp/references/starknet-contracts)
- [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [CCTP fees](https://developers.circle.com/cctp/concepts/fees)

### Official Supabase

- [Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [X OAuth 2.0](https://supabase.com/docs/guides/auth/social-login/auth-twitter)
- [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Cron](https://supabase.com/docs/guides/cron)

### Local donors

- [Swoop implementation plan](../swoop/swoop-impl-plan.md), [web](../swoop/apps/web), [backend](../swoop/apps/api/src)
- [Sable auth](../sable/apps/api/src/auth), [pending notes](../sable/packages/db/src/notes.ts), [fixed-denomination reference](../sable/packages/contracts/src/SablePool.sol)
- [Swoop license](../swoop/LICENSE), [Sable license](../sable/LICENSE)
