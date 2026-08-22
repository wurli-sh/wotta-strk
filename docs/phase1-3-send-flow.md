# Wotta — Sepolia Send Flow Execution Plan

**Status:** implementation underway; the first Sepolia product slice is implemented locally, while live gate evidence remains operator-dependent.
**Scope:** close Hard Gates 1 and 2 on Sepolia, then ship the Wotta web send flow with the sable-flare visual system and Swoop-only logic/panels.
**Canonical long-form architecture:** [`../implementation-plan.md`](../implementation-plan.md). This document is the active, testable Sepolia delivery plan and takes precedence where the older mainnet-first plan differs.

## Locked outcome

The demo journey is:

```text
Google/X login → session sync → optional provider link → Ready wallet bind
→ private identity registration → resolve email/@handle → select route + denomination
→ source-wallet approval/burn → relayer settlement → indexed “Escrowed”
→ recipient inbox unlock → private-balance claim
```

The only signing popups are Ready connection/SNIP-12 bind, source-wallet connect,
approve/burn, and a private proof or claim. All status shown after submission comes
from the API's indexed intent state; “Escrowed” means `onchain_state === "funded"`.

## Current verified baseline — 22 August 2026

| Area | State | Evidence in repository |
|---|---|---|
| Cairo pools/router | Implemented and Sepolia manifest has four verified denomination pools, a verified router, and direct privacy pool | `deployments/sepolia.json` |
| Hard Gate 1 code checks | Pass | contracts build/test, shared tests, wallet-smoke tests pass via `pnpm check:phase1:sepolia` |
| Hard Gate 1 live evidence | **Blocked on a real wallet session** | expected under `evidence/debaf151…7c52d/phase1-wallet-api/` |
| API / identity / intent surface | Implemented | `apps/api/src/server.ts`, `auth/sync.ts`, `intents/` |
| CCTP orchestration spike | Implemented, not yet live-proven | `apps/wallet-smoke/src/product-session.ts` |
| Product web app | Implemented locally; build and browser verification in progress | `apps/web` |
| UI donors | Present locally | `../sable-flare/apps/web`, `../swoop/apps/web` |

No dummy evidence, mocked success state, or enabled production route may be used to
close a gate.

## Safety correction required before Phase 2 work

`apps/api/src/routes.ts` currently enables every CCTP source whenever the *destination*
router and pools are verified, while leaving `starknet-public` disabled. That is the
opposite of the intended admission policy. Implement the following as the first Phase
2 code change:

1. Enable `starknet-public` only when the selected manifest has a verified router and
   all selected denomination pools are verified.
2. Keep every CCTP source disabled until that individual route has retained live source
   evidence and its exact source token/domain/adapter is marked admitted in the manifest.
3. Make `GET /v1/routes` return the reason and evidence reference for each disabled
   route. The UI must show only enabled routes, never infer availability from a chain name.
4. A successful Base Sepolia (or Ethereum Sepolia) CCTP E2E admits that single route;
   it does not admit the remaining CCTP routes.

This reconciles the UI requirement (public Starknet deposits become available after
destination verification) with the hard-gate requirement (cross-chain sources only
become available after their own source-chain proof).

## Hard gates and retained artifacts

### Gate 1 — private-wallet smoke

**Pass command:** `pnpm check:phase1:sepolia`

Run a real Ready/Sepolia wallet-smoke session through all eight successful flows:

`connect`, `register_identity`, `shield_register`, `balances`, `direct_transfer`,
`private_fund`, `claim_release`, `private_refund`.

Export the session, then materialize it:

```bash
pnpm evidence:wallet-api -- \
  evidence/debaf151ff7840cd9c2df97a29506c95054bc03186d36fc79516fe2f16d7c52d/phase1-wallet-api/smoke-session.json
pnpm check:phase1:sepolia
```

The materializer must produce `smoke-session.json`, `summary.json`, `events.json`, and
`source-session.sha256`. Every transaction-required flow must contain its transaction
hash and match the manifest chain and STRK20 pool.

### Gate 2 — CCTP and identity

**New pass command:** `pnpm check:phase2:sepolia`

Implement `scripts/gates/phase2-check.ts` in the same fail-closed style as the Phase 1
gate and add the root package script. It must check:

1. API unit tests and migrations apply cleanly to the configured Supabase project.
2. `/v1/routes` exposes verified `starknet-public`; it exposes a CCTP source only when
   that route's evidence is admitted.
3. Retained CCTP evidence has: route ID, intent ID, source burn hash, Iris attestation
   hash/payload digest, destination settlement hash, decoded router/pool event, and
   final indexed intent state `funded`.
4. The evidence is bound to `deployments/sepolia.json`'s manifest hash and the selected
   source domain, USDC, router, pool, denomination, claim hash, and expiry.
5. The four identity scenarios below have a dated, redacted manual checklist result;
   the eventual Playwright suite uses the same scenarios.

Store each CCTP proof at
`evidence/<manifestHash>/cctp-<route-id>-sepolia/`. The gate must fail when it is absent
or invalid; it must not accept hashes without decoded events.

## Ordered work packages

### P1 — Close Gate 1 (operator action)

- Confirm `.env` contains the Sepolia RPC, Supabase/API values, and test wallet funding.
- Run `pnpm dev:wallet-smoke`, complete the eight flows, export/materialize the session,
  and run the Gate 1 command above.
- Commit only the redacted, materialized evidence—not keys, OAuth tokens, raw viewing
  keys, claim secrets, or `.env` files.

**Done when:** Gate 1 exits zero.

### P2 — Make route admission and Gate 2 reproducible

- Add `phase2-check.ts`, package script, evidence schema/validator, and tests.
- Correct `routes.ts` using the admission policy above; add tests for unverified,
  destination-only verified, and evidence-admitted source routes.
- Apply the existing migrations with `pnpm db:migrate`; then start API, indexer, relayer,
  and wallet-smoke.
- Perform one route only—prefer Base Sepolia, then Ethereum Sepolia if Base is blocked:
  bind sender, register private identity, call `fundFromCircleSource`, observe source
  burn, relay `settle`, and wait for the indexer to report `funded`.

**Done when:** the phase-2 command exits zero and exactly one CCTP source is admitted.

### P2b — Identity acceptance checklist

| Scenario | Required assertion |
|---|---|
| Google first → link X | Google email stays; X handle and any verified X email are added |
| X first → link Google | X handle stays; verified Google email is added |
| Unlink X → sync | Only X OAuth identity is soft-revoked; wallet/private identity survive |
| Send to unknown `@handle` → signup | `deliverPendingForProfile` delivers one claim exactly once |

Supabase must permit manual linking; the X application must request user email. Capture
redacted request/response IDs and assertion results in the Gate 2 evidence directory.

### P3a — Mechanical UI transplant (separate first commit)

Create `apps/web` by copying the complete sable-flare web app **verbatim first**:
all routes, public assets, font/config files, app shell, globals, providers, auth
helpers, navigation, controls, skeletons/shimmer/minimum holds, and Playwright setup.
The first commit may only rename `@sable`/`@swoop` to `@wotta` and change Wotta-facing
copy. It may not restyle, collapse components, replace class names, or wire new data.

Use sable-flare as the visual authority for `/`, `/send` (including Send|Claim),
`/inbox`, `/account`, `/claim`, `/c`, `/register`, `/balance`, `/status`, `/privacy`,
and `/activity/[id]`. Preserve `layoutId` tab animation, mobile/table variants,
`skeleton-shimmer`, and `withMinSkeleton` timing.

Then port only the Swoop additions sable-flare lacks: private-balance, wallet-link,
inbox-key/security panels; inbox unlock provider; `SendProgress`, `QuoteCard`,
`sendReducer`, `useSendController`, `executeSend`; claim celebration; and its E2E
scaffold. Do not port Swoop's SendForm/AmountField; sable-flare's SendPage remains the
visual surface.

**Done when:** all copied routes compile against pinned dependencies and the visual
parity checklist below passes before Wotta logic is attached.

### P3b — Wotta client boundary and onboarding

Extract reusable product orchestration from `apps/wallet-smoke/src/product-session.ts`
into `apps/web/src/lib/wotta/` (or a workspace client package if both apps consume it).
Wallet-smoke must consume that same implementation afterward.

The module boundary contains session sync/link/unlink, Ready wallet bind/private identity,
recipient resolve, quote/intent/encrypted delivery, `fundFromCircleSource`, intent polling,
and the direct-SDK privacy path. It replaces donor-only Flare/Nox functions beneath the
existing JSX; remove no visual components while doing so.

Enforce the sequence: authenticated session → bound Ready wallet → registered private
identity → `/send`. Account retains a keep-one-provider guard and supports linking and
unlinking Google/X without identifier override.

### P3c — Unified send, inbox, and claim

- Feed sable-flare source controls from `GET /v1/routes`; amount chips are 1/10/50/100
  USDC from the verified manifest.
- Resolve email or `@handle`, then execute:
  `resolve → intent → quote → encrypt delivery → source connect → approve/burn →
  source-submitted → poll until funded`.
- Private Starknet sender to a registered private recipient uses direct transfer; it does
  not enter escrow. All other admitted sources use the CCTP/public-escrow path.
- Inbox decrypts with the bound inbox key. Claim executes `claim_release` and confirms
  indexed `Claimed`. Balance uses the Sepolia privacy SDK; Wallet API remains the later
  mainnet path.

### P3d — visual and browser gates

Before merge, compare the reference demos side-by-side for IslandNav, auth modal,
landing, Send|Claim tabs, inbox's three tabs/table/mobile rows, account's two tabs,
skeleton count/shimmer/hold timing, and all secondary routes. Any difference is a UI
bug, not a product redesign.

Add Playwright coverage for Google login/bind/send-to-email; X→Google linking/send to
`@handle`; the admitted CCTP route reaching `funded`; and unknown-recipient pending
delivery on signup. Wallet popup steps may be headed/manual but API/indexer assertions
must be automated.

## Work board

| ID | Deliverable | Status | Exit evidence |
|---|---|---|---|
| gate1-evidence | Eight-flow Sepolia smoke | blocked on live Ready session | Gate 1 zero exit |
| gate2-script-cctp | Route admission + Phase 2 gate + one CCTP route | admission + fail-closed gate implemented; live route evidence pending | Gate 2 zero exit |
| identity-e2e | Four identity scenarios | pending | redacted checklist + tests |
| swoop-copy | Sable copy and Swoop-only modules | implemented locally | mechanical-copy review |
| sable-flare-ui-merge | visual parity review | source parity implemented; browser pass pending | signed checklist/screenshots |
| extract-client | shared Wotta client boundary | web boundary implemented; wallet-smoke deduplication pending | web + smoke imports |
| onboarding-gates | auth/bind/private identity gate | implemented locally; live browser proof pending | browser test |
| unified-send | admitted route send card | CCTP + direct-private branches implemented; public Starknet source pending | funded intent |
| inbox-claim | inbox/decrypt/claim/balance | implemented locally; live indexed proof pending | indexed claim |
| e2e-playwright | browser regression suite | pending | CI result |

## Explicit non-goals

Mainnet deployment, the full CCTP route matrix, Redis rate limits, TTL projection worker,
refund-observed UX, and fuzz/invariant expansion are deferred. They must not be implied
by a Sepolia demo pass.
