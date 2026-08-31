<img src="docs/assets/banner.png" width="100%" alt="Wotta — send like a message, settle privately on Starknet, from any chain" />

[Live demo](https://wotta.vercel.app) · [Demo video](https://youtu.be/KqIuun51blI)

## Problem

Sending USDC across chains means choosing a bridge, checking destination support,
and finding the recipient’s correct wallet on that chain. A simple payment should
feel like sending a message, not coordinating infrastructure — and the receive
side should not force a public destination balance.

## Solution

**Sending money should feel like sending a message — Wotta makes it so.** You
send to a handle or email, not an address; the transport and private settlement
are Wotta’s job, not yours.

Wotta lets anyone send USDC to an `@handle` or email. It resolves the recipient,
creates a signed claim, transports USDC from supported source chains with Circle
CCTP V2, and delivers a protected claim notice. Registered recipients receive an
encrypted inbox note; claims settle into Wotta escrow on **Starknet Sepolia** and
can be redeemed into a private Ready balance.

On **Starknet Mainnet**, Wotta focuses on Ready wallet-managed live-pool private
sends and balance (no CCTP escrow inbox). Switch networks from the signed-in
account menu.

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
| Frontend | [wotta.vercel.app](https://wotta.vercel.app) — `/` · `/send` · `/inbox` · `/account` · `/balance` · `/claim` |
| Testnet API | [wotta-api-testnet.onrender.com](https://wotta-api-testnet.onrender.com) |
| Mainnet API | [wotta-api-mainnet.onrender.com](https://wotta-api-mainnet.onrender.com) |
| Settlement network (testnet) | Starknet Sepolia (`SN_SEPOLIA`) |
| Explorer | [Starknet Sepolia Voyager](https://sepolia.voyager.online) · [Starkscan](https://sepolia.starkscan.co) |
| Circle Sepolia USDC | [`0x0512…8343`](https://sepolia.starkscan.co/contract/0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343) |
| Wotta CCTP Router | [`0x26d4…d81b`](https://sepolia.starkscan.co/contract/0x26d49a2014db61fd072284cefa28c5d4a4ede40a2d90ed439ad3dfc0053d81b) |
| Direct privacy escrow (1 USDC) | [`0x7e5b…e8c`](https://sepolia.starkscan.co/contract/0x7e5b61d637f7c5c557ac4814202a7c922ebfe3233d51c9ec266a6c3c3826e8c) |
| STRK20 privacy pool (Sepolia) | [`0x0254…0d91`](https://sepolia.starkscan.co/contract/0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91) |
| Sepolia deployment manifest | [`deployments/sepolia.json`](deployments/sepolia.json) |
| Mainnet deployment manifest | [`deployments/mainnet.json`](deployments/mainnet.json) |

Route configuration: [`apps/web/public/manifests/routes.testnet.json`](apps/web/public/manifests/routes.testnet.json) · deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [evidence](evidence/README.md)

Testnet CCTP denominations and escrows are getter-verified in
[`deployments/sepolia.json`](deployments/sepolia.json). Mainnet pins the live
STRK20 pool for Ready wallet-managed private actions; Wotta CCTP escrow remains
testnet-scoped.

---

## Workspace

| Package / app | Purpose |
| ------------- | ------- |
| [`apps/web`](apps/web) | Next.js product UI — send, claim, inbox, account, balance, and network mode |
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
  → signs in (Google / email / optional X handle)
  → binds Ready wallet (network-scoped) and optional private identity
  → resolves @handle / email through Wotta API
  → creates intentId, claim secret, and claim hash locally
  → verifies a signed exact-net quote and recipient descriptor
  → funds USDC through CCTP V2 (testnet) or Starknet public / private routes
  → delivers an encrypted inbox note (or pending delivery)

Recipient (browser)
  → unlocks the encrypted inbox with Ready
  → waits for indexed CCTP / escrow settlement evidence
  → claims into private Ready balance (or public path where admitted)
```

```text
apps/web (Next.js)
  ↓
@wotta/shared          codecs · hook payloads · typed quote verification · manifests
@wotta/crypto          encrypted delivery helpers
@wotta/adapters        Ethereum · Arbitrum · Base · Solana · Stellar · Starknet source actions
  ↓
apps/api (Fastify)     handles · quotes · intents · delivery · indexer · relayer
  ↓
Supabase               auth · handles · wallets · encrypted inbox · intent state
  ↓
Starknet Sepolia       CCTP V2 router · denomination escrows · STRK20 privacy pool
Starknet Mainnet       Ready live-pool private send / balance (no Wotta CCTP escrow)
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
├── deployments/         checked-in Sepolia and Mainnet manifests
├── supabase/migrations/ Postgres schema
├── evidence/            retained smoke-test evidence bundles
├── docs/                deployment and privacy docs
└── scripts/             development, deploy, verification, and gate scripts
```

---

## Payment Workflow

1. **Resolve** — the sender enters an `@handle` or email. Wotta returns a signed
   recipient descriptor when the recipient is registered.
2. **Prepare** — the browser generates a claim secret, derives a claim hash, and
   builds an intent with expiry, refund recipient, and denomination.
3. **Quote and fund** — Wotta signs an exact-net quote. The source adapter then
   submits a CCTP V2 burn (EVM / Solana / Stellar) or a Starknet deposit / private
   fund path.
4. **Deliver** — registered users receive an encrypted inbox payload. Pending
   delivery covers recipients who have not finished registration yet.
5. **Settle** — the indexer / relayer validates Iris attestation and destination
   evidence, then marks the intent funded on Starknet Sepolia.
6. **Claim** — the recipient unlocks the inbox, authorizes redemption with Ready,
   and receives USDC into a private balance where the route admits it.
7. **Refund** — expired, unclaimed escrows follow the on-chain refund path to the
   public refund recipient.

---

## Key Features

Send like a message. Settle privately on Starknet. From any chain — every feature
maps to one of those three promises:

- **Handle-first payments** — send to `@handle` or email without requesting a destination address *(like a message)*
- **Multi-chain source funding** — Ethereum, Arbitrum, Base, Solana, Stellar testnets, plus Starknet public / private routes *(from any chain)*
- **Private post-claim balance** — Ready + STRK20 privacy pool on Sepolia; live-pool private send / balance on Mainnet *(settle privately)*
- **Protected delivery** — encrypted registered inbox notes
- **Exact-net quotes** — quote includes the desired receive amount, maximum CCTP fee, and finality threshold
- **One-time claims** — claim-hash commitments, expiry, and replay protection
- **Gas-sponsored settlement** — the Sepolia relayer submits CCTP `settle` but cannot redirect recipient funds
- **Network-scoped product** — Testnet (CCTP + inbox) and Mainnet (Ready live pool) in one UI
- **OpenAPI contract** — [`apps/api/public/openapi.json`](apps/api/public/openapi.json) supports typed API clients

---

## Tech Stack

| Layer | Stack |
| ----- | ----- |
| Frontend | Next.js, React, Tailwind, Starknet.js, Ready |
| API | Fastify, Zod, OpenAPI, Pino |
| Contracts | Cairo, Scarb, Starknet Foundry |
| Cross-chain settlement | Circle CCTP V2 → Starknet Sepolia |
| Privacy layer | Starknet privacy SDK / STRK20 pool, Ready |
| Data | Supabase (Postgres + Auth) |
| Delivery | Encrypted inbox payloads |
| Source chains | Ethereum, Arbitrum, Base, Solana, Stellar (testnets), Starknet |

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
| `pnpm check:phase1:sepolia` | Runs Sepolia phase-1 hard-gate checks |
| `pnpm check:phase2:sepolia` | Runs Sepolia phase-2 hard-gate checks |
| `pnpm deploy:env` | Syncs production env to Vercel / Render from local `.env` |
| `pnpm check` | Runs lint, typecheck, tests, and build |

Copy [`.env.example`](.env.example) to `.env`, then follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Environment & Deployment

The normal hosted topology is a Vercel web app and two Render API services
(testnet + mainnet), with Supabase and RPC providers.

```bash
pnpm deploy:env -- --dry-run \
  --web-origin https://wotta.vercel.app \
  --testnet-api-origin https://wotta-api-testnet.onrender.com \
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
- **Relayer limits** — it can sponsor a valid Sepolia settlement but has no privilege to redirect recipient funds.
- **Not production-ready** — this is unaudited hackathon software; live route evidence and operational safeguards remain required.

More detail: [`docs/direct-privacy-sepolia.md`](docs/direct-privacy-sepolia.md) · [`docs/phase1-3-send-flow.md`](docs/phase1-3-send-flow.md) · [`docs/third-party-privacy-sdk.md`](docs/third-party-privacy-sdk.md)

---

## Future Plans

- **Harden the core** — Make CCTP → Sepolia settlement, indexer/relayer, and claim/refund paths reliable under real load.
- **Keep Starknet as settlement** — Grow source rails into one private receive surface, not fragmented pools.
- **Make privacy feel like messaging** — Sharpen handle/email send, inbox unlock, Ready linking, and claim UX.
- **Close the Mainnet gap** — Expand live STRK20 / Ready private sends beyond current demo evidence.
- **Prepare for review** — Threat model, runbooks, and an audit / mainnet readiness plan before production claims.

---
