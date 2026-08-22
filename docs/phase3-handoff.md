# Phase 1/2 → Phase 3 handoff

## Product contract

Phase 3 should present one account and one send action. The implementation
behind it is intentionally more explicit:

1. Start OAuth with Google or X. When a session already exists, use Supabase
   `linkIdentity`; never fall back to `signInWithOAuth` for linking.
2. Call `POST /v1/session/sync`. X registers its canonical handle and an email
   route only when the X identity supplies a verified email. Google registers
   its verified email. Linking either provider never replaces the other.
   The X Developer App must have **Request email from users** enabled.
3. Connect Ready and complete `/v1/wallet/challenge` → `/v1/wallet/link`.
4. Create/register the Ready-owned private identity, then publish it through
   `/v1/wallet/private-identity`. The current direct client orchestrates these
   approvals automatically after Ready connects.
5. Resolve a recipient with provider `x` for `@handle` and `email` for an email.
6. For a remote source, create the intent and encrypted delivery before the
   irreversible Circle burn, execute the source-wallet approvals, submit the
   source transaction, and poll the owned intent until `onchain_state=funded`.
7. The recipient loads the encrypted claim and accepts it into the STRK20
   private balance. Private sends resolve the same email/handle to the verified
   private identity and remain private-balance → private-balance.

## Identity invariants

- One Supabase profile may own Google and X simultaneously.
- The same verified email may have Google and X evidence on that same profile.
- An email or X handle cannot be active on two profiles. Application checks
  and a database trigger both enforce this.
- Supabase unlink is followed by `/v1/session/sync`; only rows sourced from the
  removed OAuth identity are soft-revoked. Wallet and private-balance bindings
  stay attached to the profile.
- The last Supabase sign-in identity cannot be unlinked.
- X email fallback is accepted only for an X-only Supabase user. Once Google is
  also present, Wotta does not guess that `user.email` belongs to X.

## Phase 3 API surface

- `POST /v1/session/sync` — reconcile verified OAuth identities and pending inbox
- `GET /v1/me` — profile, active identities, Ready binding, private identity
- `POST /v1/resolve` — signed recipient descriptor for email or X
- `POST /v1/wallet/challenge`, `POST /v1/wallet/link`
- `POST /v1/wallet/private-identity`
- `GET /v1/routes`, `POST /v1/quotes`
- `POST /v1/intents`, `GET /v1/intents`, `GET /v1/intents/:id`
- `POST /v1/intents/:id/delivery`, `POST /v1/intents/:id/source-submitted`
- `GET /v1/notes`, `POST /v1/notes/:id/delivered`

The intent response carries both workflow `state` and chain-derived
`onchain_state`. Phase 3 should call a payment “escrowed” only after
`onchain_state=funded` (or the relayer has reached `funded`/`delivered`).

## Local testnet stack

`pnpm dev` starts the product web UI (:3000), API, relayer, and Starknet indexer. The indexer
uses deployment blocks from `deployments/sepolia.json`, stores canonical Wotta
escrow events, and resets/replays the projection when the cursor block hash no
longer matches Starknet.

## Evidence boundary

Automated code, database, contract, route-fee, and indexer checks can run
without wallets. OAuth provider consent, Ready proof signatures, and source
chain burns still require the user's wallet/provider popups. Do not fabricate
Hard Gate evidence for those steps; export and materialize the actual session.
