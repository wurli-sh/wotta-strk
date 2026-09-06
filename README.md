<img src="docs/assets/banner.png" width="100%" alt="Wotta — send from any chain, claim private on Starknet, earn on Vesu" />

[Live demo](https://wotta.vercel.app) · [Demo video](https://youtu.be/KqIuun51blI)

## Problem

Sending USDC across chains means choosing a bridge, checking destination support,
and finding the recipient’s correct wallet on that chain. A simple payment should
feel like sending a message, not coordinating infrastructure — and the receive
side should not force a public destination balance.

## Solution

**Send from any chain. Claim private on Starknet. Earn on Vesu.** You send to a
handle or email, not an address; the transport and private settlement are Wotta’s
job, not yours.

Wotta lets anyone send USDC to an `@handle` or email. Sign in with **Google or X**,
link a **Ready** wallet, and resolve recipients through the API. Wotta creates a
signed claim, transports USDC from supported source chains with Circle CCTP V2,
and delivers an encrypted inbox note. Claims settle privately on **Starknet
Mainnet** into a Ready private balance — then put that USDC to work on **Vesu
Earn**. Live-pool private send / balance runs through the Ready-managed STRK20
pool.

### Mainnet STRK20 evidence

Private sends through the live STRK20 pool (Wallet One → Wallet One’s linked X
handle). Each tx succeeded on Starknet Mainnet and touched the pool:

| Tx | Voyager |
| -- | ------- |
| 1 | [0x05865c…fa4eb6](https://voyager.online/tx/0x05865c9b8592d5da05f5f031624476c6d681fd72b7da49eb0697adb2dafa4eb6) |
| 2 | [0x022b04…ff4dee](https://voyager.online/tx/0x022b049c23b35cc5b515a2e607004b1800a8a853007fe6cf4a84a6c74cff4dee) |
| 3 | [0x0191ca…4d9efb](https://voyager.online/tx/0x0191caf99580ca2f043e05b92fd96defb188492f5d3c32e5f485f685164d9efb) |

Also listed in [`strk20.json`](strk20.json) for the Private Sprint hub.

---

## Deployments

| Resource | Value |
| -------- | ----- |
| Frontend | [wotta.vercel.app](https://wotta.vercel.app) — `/` · `/send` · `/inbox` · `/account` · `/claim` |
| Mainnet API | [wotta-api-mainnet.onrender.com](https://wotta-api-mainnet.onrender.com) |
| Settlement network | Starknet Mainnet (`SN_MAIN`) |
| Explorer | [Voyager](https://voyager.online) · [Starkscan](https://starkscan.co) |
| Native USDC (Mainnet) | [`0x0330…35fb`](https://starkscan.co/contract/0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb) |
| Wotta CCTP Router | [`0x24a2…00fd`](https://starkscan.co/contract/0x24a2c1a79b97794ed4d143ff0f6f5b05b3569832c85957aa10bc7c3dcc000fd) |
| STRK20 private pool | [`0x0403…812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |
| Escrow 0.1 USDC | [`0x656a…0a06`](https://starkscan.co/contract/0x656a3300531b45f559e51120b0cb9bcea8c6c4e626ebef6c46c184da08c0a06) |
| Escrow 1 USDC | [`0x41a7…8f0c`](https://starkscan.co/contract/0x41a7424a3779e15d68f7a1da96b7cf95a196563bcfc3ff81eeb8735c4368f0c) |
| Vesu Earn anonymizer (RC.2) | [`0x4ee6…e38`](https://starkscan.co/contract/0x4ee621484a3dfda3976b5fd37749e50727a7697296a46fbd0fd81c4d42dfe38) |
| Deployment manifest | [`deployments/mainnet.json`](deployments/mainnet.json) |

Deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [evidence](evidence/README.md)

Mainnet pins the live STRK20 pool for Ready wallet-managed private actions,
verified 0.1 / 1 USDC CCTP escrows (Base and Solana domains admitted on the
router), and a live Vesu Earn anonymizer with deposit+redeem smoke above.
`vesuEarn.status` is **`verified`** — see
[`GO-NO-GO`](evidence/cfdce498920dc89271f898091a529bea191ebc7b5901323d2e667d9cc7e3ce00/vesu-earn/GO-NO-GO.md).

---

## Workspace

| Package / app | Purpose |
| ------------- | ------- |
| [`apps/web`](apps/web) | Next.js product UI — send, claim, inbox, account, balance, and Earn |
| [`apps/api`](apps/api) | Fastify API — identity, resolution, quotes, intents, delivery, indexer, and relayer |
| [`apps/wallet-smoke`](apps/wallet-smoke) | Browser smoke harness for Ready / privacy / product flows |
| [`contracts`](contracts) | Cairo / Scarb — CCTP router, denomination escrows, privacy identity |
| [`packages/adapters`](packages/adapters) | Source-chain adapters for EVM, Solana, Stellar, and Starknet funding |
| [`packages/crypto`](packages/crypto) | Claim encryption and cryptographic helpers |
| [`packages/shared`](packages/shared) | Protocol codecs, schemas, typed quotes, manifests, and claim hashing |

---

## Core Architecture

```text
Sender (browser)
  → signs in (Google or X OAuth)
  → binds Ready wallet on Starknet Mainnet and optional private identity
  → resolves @handle / email through Wotta API
  → creates intentId, claim secret, and claim hash locally
  → verifies a signed exact-net quote and recipient descriptor
  → funds USDC through CCTP V2 (Base / Solana) or Starknet private routes
  → delivers an encrypted inbox note (or pending delivery)

Recipient (browser)
  → unlocks the encrypted inbox with Ready
  → waits for indexed CCTP / escrow settlement evidence
  → claims into private Ready balance

Earn (Ready)
  → reads Vesu Prime Supply APY and private position in /account?tab=earn
  → deposits / redeems when vesuEarn.status is verified (or withdraw_only for redeem)
```

```text
apps/web (Next.js)
  ↓
@wotta/shared          codecs · hook payloads · typed quote verification · manifests
@wotta/crypto          encrypted delivery helpers
@wotta/adapters        Base · Solana · Starknet source actions (Mainnet rails)
  ↓
apps/api (Fastify)     handles · quotes · intents · delivery · indexer · relayer
  ↓
Supabase               auth · handles · wallets · encrypted inbox · intent state
  ↓
Starknet Mainnet       STRK20 live pool · CCTP router + 0.1/1 USDC escrows
                       · Vesu Earn anonymizer
```

```text
wotta/
├── apps/
│   ├── web/             Next.js frontend
│   ├── api/             Fastify API, indexer, and relayer
│   └── wallet-smoke/    optional Ready / privacy smoke UI
├── contracts/           Cairo contracts and forge tests
├── packages/
│   ├── adapters/        source-chain funding adapters
│   ├── crypto/          encryption / cryptographic helpers
│   ├── shared/          protocol types, codecs, and manifests
│   └── config/          shared TypeScript config
├── deployments/         checked-in Mainnet manifest
├── supabase/migrations/ Postgres schema
├── evidence/            retained smoke-test evidence bundles
├── demo/                voiceover / demo toolkit
├── docs/                deployment and privacy docs
└── scripts/             development, deploy, verification, and gate scripts
```

---

## Payment Workflow

1. **Resolve** — the sender enters an `@handle` or email. Wotta returns a signed
   recipient descriptor when the recipient is registered.
2. **Prepare** — the browser generates a claim secret, derives a claim hash, and
   builds an intent with expiry, refund recipient, and denomination (0.1 or 1 USDC).
3. **Quote and fund** — Wotta signs an exact-net quote. The source adapter then
   submits a CCTP V2 burn (Base / Solana) or a Starknet private fund path.
4. **Deliver** — registered users receive an encrypted inbox payload. Pending
   delivery covers recipients who have not finished registration yet.
5. **Settle** — the indexer / relayer validates Iris attestation and destination
   evidence, then marks the intent funded on Starknet Mainnet.
6. **Claim** — the recipient unlocks the inbox, authorizes redemption with Ready,
   and receives USDC into a private balance.
7. **Earn** — private USDC can be supplied to Vesu through Ready when Earn writes
   are admitted; the UI shows Supply APY and position.
8. **Refund** — expired, unclaimed escrows follow the on-chain refund path to the
   public refund recipient.

---

## Key Features

Send like a message. Settle privately on Starknet. From any chain — every feature
maps to one of those three promises:

- **Handle-first payments** — send to `@handle` or email without requesting a destination address *(like a message)*
- **OAuth sign-in** — Google or X only; X when you want a public handle
- **Multi-chain source funding** — Base and Solana CCTP into Mainnet escrows, plus Starknet private routes *(from any chain)*
- **Private post-claim balance** — Ready private USDC via the live STRK20 pool *(settle privately)*
- **Vesu Earn** — `/account?tab=earn` shows Deposit / Redeem, curated Prime **Supply APY**, and private balances. Mainnet deposit+redeem smoke is receipt-verified; `vesuEarn.status` is **`verified`** (`pnpm check:vesu-earn`).
- **Protected delivery** — encrypted registered inbox notes; inbox keys derived from Ready
- **Exact-net quotes** — quote includes the desired receive amount, maximum CCTP fee, and finality threshold
- **One-time claims** — claim-hash commitments, expiry, and replay protection
- **Gas-sponsored settlement** — the Mainnet relayer submits CCTP `settle` but cannot redirect recipient funds
- **OpenAPI contract** — [`apps/api/public/openapi.json`](apps/api/public/openapi.json) supports typed API clients

---

## Tech Stack

| Layer | Stack |
| ----- | ----- |
| Frontend | Next.js, React, Tailwind, Starknet.js, Ready |
| API | Fastify, Zod, OpenAPI, Pino |
| Contracts | Cairo, Scarb, Starknet Foundry |
| Cross-chain settlement | Circle CCTP V2 → Starknet Mainnet |
| Privacy layer | Starknet privacy SDK / STRK20 pool, Ready |
| Yield | Vesu Prime via privacy anonymizer |
| Data | Supabase (Postgres + Auth) |
| Delivery | Encrypted inbox payloads |
| Source chains | Base, Solana, Starknet |

---

## Local Development

**Prerequisites:** Node.js `>=24` · pnpm `10.33.0` · Scarb / snforge · Supabase
for full integration · Ready wallet for private flows

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Starts web, API, indexer, and relayer together |
| `pnpm dev:web` | Starts the Next.js web app |
| `pnpm dev:api` | Starts the Fastify API |
| `pnpm dev:indexer` | Starts the Starknet escrow indexer |
| `pnpm dev:relayer` | Starts the CCTP settlement relayer |
| `pnpm test` | Runs shared, crypto, adapter, API, and web tests |
| `pnpm test:api` | Runs API tests |
| `pnpm test:web` | Runs web tests |
| `pnpm test:contracts` | Runs Cairo contract tests |
| `pnpm check:vesu-anonymizer-source` | Rebuilds pinned RC.2 Vesu anonymizer and compares Sierra + CASM hashes to `mainnet.json` (needs exactly Scarb 2.17.0) |
| `pnpm check:vesu-earn` | Vesu Earn admission gate; prints `admit verified` when source parity + smoke pass |
| `pnpm deploy:env` | Syncs Vercel variables; creates missing Render services (existing Render env remains Blueprint/dashboard-managed) |
| `pnpm deploy:env -- --render-only --render-deploy` | Explicitly deploys the current Git commit to the existing Mainnet Render service |
| `pnpm deploy:check-mainnet` | Fails if the hosted Mainnet API does not match the verified local router, escrows, or manifest hash |
| `pnpm check` | Runs lint, typecheck, tests, and build |

Copy [`.env.example`](.env.example) to `.env`, then follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Environment & Deployment

The hosted topology is a Vercel web app and a Mainnet Render API service, with
Supabase and RPC providers.

```bash
pnpm deploy:env -- --dry-run \
  --web-origin https://wotta.vercel.app \
  --mainnet-api-origin https://wotta-api-mainnet.onrender.com
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full setup, production
environment synchronization, and operational verification.

---

## Trust & Security

- **Privacy with clear limits** — Wotta aims for private receive / private balance on Starknet; source burns, timing, and public escrow funding remain observable where CCTP is used.
- **No plaintext registered claims at rest** — recipient claim payloads are encrypted before inbox delivery.
- **Recipient protection** — registered claims bind the recipient profile; claim secrets never leave the encrypted note / client claim flow.
- **Claim and refund safety** — commitments, expiry, denomination, and one-time claim checks are enforced on chain.
- **CCTP validation** — settlement accepts CCTP V2 messages only after required finality and fee checks.
- **Relayer limits** — it can sponsor a valid Mainnet settlement but has no privilege to redirect recipient funds.
- **Not production-ready** — this is unaudited hackathon software; live route evidence and operational safeguards remain required.

More detail: [`docs/phase1-3-send-flow.md`](docs/phase1-3-send-flow.md) · [`docs/third-party-privacy-sdk.md`](docs/third-party-privacy-sdk.md) · [`docs/runbooks/vesu-earn-smoke.md`](docs/runbooks/vesu-earn-smoke.md) · [`docs/SECURITY.md`](docs/SECURITY.md)

---

## Future Plans

The core is live on **Starknet Mainnet** — CCTP pay-in, private claim, Vesu Earn.
Next we harden that path and grow carefully, without pretending this is audited
production software.

- **Harden the core** — CCTP indexer/relayer, claim/refund, and Earn under real load; clear monitoring when Iris, a source chain, or the relayer is down.
- **More pools and rails** — expand fixed denominations and additional source routes into the same Starknet private receive surface (Ready + STRK20 + Vesu), not a new pool on every chain.
- **Privacy like messaging** — sharper inbox unlock, Ready linking, claim recovery, and Earn UX; stay non-custodial.
- **Honest privacy** — keep labeling what Wotta shields vs what stays public (source burns, timing, escrow funding).
- **Real use cases** — validate pay-a-handle → claim → earn with community feedback before chasing a long feature list.
- **Review readiness** — threat model, runbooks, and an audit brief before any production claims.


