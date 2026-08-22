# Wotta dependency baseline

Pinned toolchain for Phase 1. Update this file whenever a protocol pin changes.

## Node and TypeScript

| Tool | Version | Provenance |
| --- | --- | --- |
| Node.js | >=24 | Swoop workspace baseline (`../swoop/package.json`) |
| pnpm | 10.33.0 | Swoop workspace baseline |
| TypeScript | 5.8.3 | Swoop workspace baseline |

## Starknet and privacy (locked)

| Tool | Version | Provenance |
| --- | --- | --- |
| starknet (npm) | 10.5.0 | Wotta implementation plan section 3 |
| Wallet API schema | v0.10.3 | Wotta implementation plan section 3 |
| Scarb | 2.17.0 | Wotta implementation plan section 3 |
| Starknet Foundry (snforge) | 0.59.0 | Wotta implementation plan section 3 |
| Cairo edition | 2024_07 | Wotta implementation plan section 3 |
| OpenZeppelin Cairo | 3.0.0 | Wotta implementation plan section 3 |
| starknet-privacy tag | PRIVACY-0.14.3-RC.0 (`fe52334...`) | Wotta implementation plan section 3 |
| direct Privacy SDK smoke | `0.14.3-rc.2` (vendored tarball) | Wotta Sepolia direct privacy row; see `docs/third-party-privacy-sdk.md` |

Record live wallet version, STRK20 pool address/class hash, and smoke outcomes here after Task 1A / Task 2.

## Task 2 wallet-smoke verification slots

Fill these only from a real Ready browser session. Do not invent hashes or balances.

| Slot | Value | Notes |
| --- | --- | --- |
| Ready wallet version | _pending live session_ | From `starknet:walletApi.walletVersion` |
| Wallet API versions | _pending live session_ | Must include `0.10.3` |
| STRK20 pool address | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` | Pinned in `deployments/mainnet.json` |
| STRK20 class hash | _pending live session_ | Record when verified |
| Flow 1 `strk20Balances` | _pending_ | Safe read only |
| Flow 2 direct private transfer | _pending_ | Simulate then invoke |
| Flow 3 stateful private fund | _pending_ | Expect empty `OpenNoteDeposit` span |
| Flow 4 claim/release | _pending_ | Expect one `OpenNoteDeposit` |
| Evidence path | `evidence/<manifest-hash>/phase1-wallet-api/` | Materialize via `pnpm evidence:wallet-api -- <session.json>` |

Commands:

```bash
pnpm --filter @wotta/wallet-smoke test
pnpm --filter @wotta/wallet-smoke typecheck
pnpm dev:wallet-smoke
pnpm smoke:wallet-api   # env preflight only
pnpm evidence:wallet-api -- ./path/to/exported-session.json
```

## Workspace packages (Task 1 scaffold)

| Package | Role | Donor |
| --- | --- | --- |
| `@wotta/config` | Shared tsconfig export | Swoop `packages/config` |
| `@wotta/shared` | Codecs, fixtures, smoke scripts | Swoop `packages/shared` |
| `@wotta/crypto` | Claim and encryption helpers | Swoop `packages/crypto` |
| `@wotta/adapters` | Chain adapters | Swoop `packages/adapters` |
| `@wotta/wallet-smoke` | Ready / Wallet API spike app | Swoop `apps/wallet-smoke` |
| `@wotta/contracts` | Cairo escrow and CCTP router | New; Scarb replaces Swoop Foundry |

`@wotta/config` is intentionally minimal for now. The scaffold now uses `@wotta/config/tsconfig.base.json` from package tsconfigs so later packages can switch local build behavior without rewriting every `extends` path.

Task 1 `build` remains a scaffold validation step, not an artifact-emitting release build. Package `build` scripts delegate to `build:scaffold` (`tsc --noEmit`) on purpose; when a package needs emitted output, give it a local `tsconfig.build.json` and replace only that package's `build` script.

## Smoke script provenance

- `scripts/e2e/wallet-api-smoke.sh` orchestrates Phase 1 wallet capability env preflight.
- `packages/shared/scripts/wallet-api-smoke.mjs` follows the env preflight pattern from Swoop `packages/shared/scripts/phase1-live-smoke.mjs`.
- `apps/wallet-smoke` is the browser Ready/STRK20 spike (`pnpm dev:wallet-smoke`, port **5173** — not started by `pnpm dev`).
- `packages/shared/scripts/materialize-wallet-api-evidence.mjs` turns an exported smoke-session JSON into `evidence/<manifest-hash>/phase1-wallet-api/` (`pnpm evidence:wallet-api -- <session.json>`).

## Verification record (Task 1)

Recorded on 2026-08-20:

- Install command: `pnpm install` (exit 0, pnpm 10.33.0, 59 packages)
- Build command: `pnpm build` (exit 0; excludes `@wotta/contracts` until Scarb is installed)
- Check command: `pnpm check` (exit 0; lint, typecheck, test, build)
- Test command: `pnpm test` (exit 0; shared, crypto, and adapters scaffold tests)
- Lockfile hash: `119442d09a0f78d3dc466bc6f058a0d4e08195746ad7f421fa5768b1b14737a3`
- Scarb/snforge: not installed in verification environment; run `pnpm contracts:build` after installing Scarb 2.17.0 and snforge 0.59.0

Contributor note: Node 24 is pinned in the root `.nvmrc` in addition to the workspace `engines.node` field.

## Sepolia direct-SDK verification (2026-08-20)

- Ready remains the public-transaction and SNIP-12 signer; the local test
  paymaster submits the outer V3 transaction because connected wallets cannot
  forward externally generated `proofFacts`.
- Compatible pool and identity class were verified through Sepolia RPC.
- Hosted prover `/health` returned `200 {"status":"ok"}` through the local proxy.
- Hosted discovery `/health` returned `200`, status `OK`, with a five-second index lag during verification.
- `pnpm check` exits 0 with 25 wallet-smoke tests.
- `pnpm contracts:build` and `pnpm test:contracts` exit 0 (4 Cairo tests).
- `pnpm check:phase1` still fails closed only on the intentionally absent live mainnet Ready evidence artifacts.

## Phase 1 contract + gate record (2026-08-20 continuation)

- Scarb `2.17.0` and snforge `0.59.0` installed locally.
- `pnpm contracts:build` exit 0.
- `pnpm test:contracts` exit 0 — 3 integration tests (public deposit/refund, CCTP settle→pool, claim/refund hash domain separation).
- `pnpm --filter @wotta/shared test` exit 0 — claim/hook/CCTP fixtures + mutation tests.
- `pnpm --filter @wotta/wallet-smoke test` exit 0 — 17 pure-logic tests.
- `pnpm check:phase1` fails closed until live Ready evidence is materialized (expected): missing `wallet-smoke-artifacts` / materialized `manifestHash`.
- Live mainnet declare/deploy and Ready browser proof remain manual; do not invent evidence.
