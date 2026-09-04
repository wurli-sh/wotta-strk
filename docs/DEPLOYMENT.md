# Wotta production deployment

Wotta production is one Vercel web app backed by two fail-closed Render API services:

| Component | Origin | Network/processes |
| --- | --- | --- |
| Web | `https://wotta.vercel.app` | Shared UI and Testnet/Mainnet selector |
| Testnet API | `https://wotta-api-testnet.onrender.com` | `SN_SEPOLIA`, API + indexer + relayer |
| Mainnet API | `https://wotta-api-mainnet.onrender.com` | `SN_MAIN`, all payment routes disabled until their individual gates pass |

The Mainnet service starts with indexer/relayer and all admissions disabled. Starknet-native send uses Wotta escrow → encrypted inbox → Ready/STRK20 claim, and requires the indexer plus `STARKNET_PRIVATE_ADMITTED=true` only after retained live evidence. Base/Solana additionally require the paired relayer and their independent evidence gates.

The Vercel project Root Directory must be `apps/web`, Framework Preset `Next.js`, and “Include source files outside of the Root Directory” enabled. Build/install/output settings stay on their framework defaults so paths remain relative to `apps/web`.

## One-time prerequisites

1. Set `DATABASE_POOLER_URL` to the Supabase session-pooler URI and run `pnpm db:migrate` (required on IPv4-only networks). Keep `DATABASE_URL` for the direct connection if other tooling uses it.
2. In Supabase Auth, set Site URL to the production web origin and allow these redirects:
   - `https://wotta.vercel.app/**`
   - any custom production domain, if added
   - local development redirects already in use
3. Make sure Google/X provider callback configuration still points to the Supabase callback URL.
4. Fund the Sepolia relayer account with enough STRK and keep its key server-side only.
5. Confirm `deployments/sepolia.json` and `deployments/mainnet.json` pass manifest hashing and RPC-chain checks.

## Environment checklist

Local `.env` is the source for `pnpm deploy:env`. Never commit it.

Required by both Render APIs:

- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- `STARKNET_MAINNET_RPC_URL`
- `RESOLVER_SIGNING_KEY`, `IDENTITY_LOOKUP_KEY`, `PENDING_DELIVERY_PRIVATE_KEY`
- `API_ORIGIN`, `CORS_ORIGINS` (the sync command supplies production values)

Required by the Testnet Render API/workers:

- `STARKNET_RPC_URL`
- `STARKNET_DEPLOYER_ADDRESS`, `STARKNET_DEPLOYER_PRIVATE_KEY`
- preferably dedicated `STARKNET_RELAYER_ADDRESS`, `STARKNET_RELAYER_PRIVATE_KEY`
- `CIRCLE_IRIS_BASE_URL=https://iris-api-sandbox.circle.com`
- `CCTP_ADMITTED_ROUTES=ethereum,arbitrum,base,solana,stellar`
- `RUN_INDEXER=true`, `RUN_RELAYER=true`

Required by Mainnet Render API:

- `STARKNET_RPC_URL=<mainnet RPC>`
- `STARKNET_NETWORK=mainnet`
- initial closed state: `RUN_INDEXER=false`, `RUN_RELAYER=false`, `STARKNET_PRIVATE_ADMITTED=false`, `CCTP_ADMITTED_ROUTES=`
- Starknet escrow pilot only after its gate: `RUN_INDEXER=true`, `RUN_RELAYER=false`, `STARKNET_PRIVATE_ADMITTED=true`
- CCTP pilot only after Phase 2/3 gates: `RUN_INDEXER=true`, `RUN_RELAYER=true`, route-specific `CCTP_ADMITTED_ROUTES`, dedicated relayer credentials, and independent fallback RPCs

Verified Mainnet contracts (source of truth: `deployments/mainnet.json` — no `ROUTER_*` / `ESCROW_*` env vars):

| Artifact | Address |
|---|---|
| Router | `0x024a2c1a79b97794ed4d143ff0f6f5b05b3569832c85957aa10bc7c3dcc000fd` |
| 0.1 USDC escrow | `0x0656a3300531b45f559e51120b0cb9bcea8c6c4e626ebef6c46c184da08c0a06` |
| 1 USDC escrow | `0x041a7424a3779e15d68f7a1da96b7cf95a196563bcfc3ff81eeb8735c4368f0c` |

Approved dens are `100000` / `1000000` only. On-chain posture stays paused with Base domain 6 and Solana domain 5 unadmitted until controlled activation. Indexer must watch only verified approved pools (never `UNDEPLOYED` 10/50/100 placeholders).

Activation after evidence (separate operator authorization):

1. Code merged with fail-closed local Mainnet defaults.
2. Deploy API with workers/admissions off; confirm closed `/v1/routes`.
3. Retain Phase 1 + `starknet-private-mainnet` evidence → `RUN_INDEXER=true` + `STARKNET_PRIVATE_ADMITTED=true`.
4. Per CCTP rail: relayer + source RPC + Iris production → admit one of `base`/`solana` → owner `set_source_domain_admitted` then `unpause` → retain route evidence → `pnpm check:phase3` → public exposure.

Mainnet contract declaration/deployment uses only `STARKNET_MAINNET_RPC_URL`, `STARKNET_MAINNET_DEPLOYER_ADDRESS`, and `STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY`. An Argent X 5.16.3 deployer with a guardian additionally requires `STARKNET_MAINNET_DEPLOYER_GUARDIAN_PRIVATE_KEY`; the scripts verify it matches the on-chain guardian and compose the required owner-plus-guardian signature. Pilot policy keeps `authority.owner` identical to the deployer: `pnpm contracts:sync-manifest` (also the first step of `pnpm contracts:preflight`) writes both from `.env` and rehashes `deployments/mainnet.json`. Declare/deploy scripts re-sync the same way before gating. The preflight rejects reuse of the Sepolia deployer, estimates both declarations with bounded fees, and requires the balance to cover both bounds. `STARKNET_MAINNET_RELAYER_ADDRESS` / `STARKNET_MAINNET_RELAYER_PRIVATE_KEY` are required only when the mainnet CCTP relayer is enabled.

**Evidence is not a declare/deploy prerequisite.** Requiring mainnet CCTP / Starknet-private evidence *before* `contracts:declare` is a chicken-and-egg loop (those flows need the live router/escrow). Order of operations:

1. **Sepolia / testnet** — prove product paths with `pnpm check:phase1:sepolia` / `pnpm check:phase2:sepolia` (and existing testnet route smoke).
2. **Mainnet declare + deploy** — `pnpm contracts:preflight` then `MAINNET_DECLARE_SUBMIT=1` / `MAINNET_DEPLOY_SUBMIT=1` (fee, identity, RPC gates only).
3. **Mainnet live smoke + evidence** — materialize `evidence/<manifestHash>/…` from real Ready/CCTP/private runs.
4. **Admit routes** — `pnpm check:phase1` / `pnpm check:phase3`, then set `STARKNET_PRIVATE_ADMITTED` / `CCTP_ADMITTED_ROUTES` and enable workers.

`pnpm check:phase1` (mainnet) and `pnpm check:phase3` fail closed on missing mainnet evidence by design — they gate **route admission**, not contract publication.

Run the automated declaration preflight with one command:

```bash
pnpm contracts:preflight
```

It syncs owner/deployer from `.env`, builds, runs Cairo and script tests, verifies SN_MAIN, computes artifact hashes, estimates both declaration bounds with `tip: 0`, and checks deployer balance. It never submits unless `MAINNET_DECLARE_SUBMIT=1` is set explicitly. Deployment likewise requires `MAINNET_DEPLOY_SUBMIT=1`.

Required by Vercel:

- the three origins: `NEXT_PUBLIC_APP_ORIGIN`, `NEXT_PUBLIC_TESTNET_API_URL`, `NEXT_PUBLIC_MAINNET_API_URL`
- `NEXT_PUBLIC_API_URL` as the Testnet compatibility alias
- Supabase public URL/publishable key (never the service-role key)
- public Sepolia/Mainnet Starknet RPC URLs, plus Solana/Stellar testnet RPC URLs
- `PRIVACY_PROVER_UPSTREAM`, `PRIVACY_DISCOVERY_UPSTREAM`
- server-only Sepolia privacy submitter: `STARKNET_RPC_URL`, `STARKNET_DEPLOYER_ADDRESS`, `STARKNET_DEPLOYER_PRIVATE_KEY`

Optional origin overrides before sync:

```bash
export PROD_WEB_ORIGIN=https://wotta.vercel.app
export PROD_TESTNET_API_ORIGIN=https://wotta-api-testnet.onrender.com
export PROD_MAINNET_API_ORIGIN=https://wotta-api-mainnet.onrender.com
```

## Deploy

```bash
pnpm db:migrate
pnpm check
pnpm deploy:env
git push origin main
vercel --prod --yes --scope wurli-shs-projects
```

`render.yaml` is the infrastructure declaration. The first `pnpm deploy:env` creates missing services through the configured Render CLI. Existing Render environment variables remain Blueprint/dashboard-managed because the Render CLI does not expose an environment-variable update command. After the verified manifest has been committed and pushed, deploy that exact commit explicitly, then verify the running API rather than assuming the service updated:

```bash
pnpm deploy:env -- --render-only --render-deploy
pnpm deploy:check-mainnet
```

`deploy:check-mainnet` compares `/v1/health` and `/v1/routes` with the checked-in verified `deployments/mainnet.json`: `SN_MAIN`, manifest hash, router, and the approved verified escrow set must all match. It is read-only and does not admit routes or enable workers. Use `--origin <URL>` for a non-default service and `--timeout-ms <1000..120000>` while diagnosing a cold start.

## Live verification

```bash
curl -fsS https://wotta-api-testnet.onrender.com/v1/health
curl -fsS https://wotta-api-mainnet.onrender.com/v1/health
curl -fsS https://wotta.vercel.app
```

Expected API health:

- Testnet: `chainId=SN_SEPOLIA`, `workers.indexer=true`, `workers.relayer=true`
- Mainnet: `chainId=SN_MAIN`, both worker flags false

Browser smoke test:

1. Sign in and switch Testnet/Mainnet from the shared account dropdown.
2. Confirm Send, Inbox, Claim, Account, and Balance use the same shell and clear network-scoped state.
3. Testnet: create a quote/intent and confirm Inbox/Claim data stays Sepolia-scoped.
4. Mainnet: while closed, confirm Starknet Send/Inbox/Claim report the verified-escrow gate. After approved activation, deposit the smallest approved fixed denomination, confirm encrypted inbox delivery, and claim through Ready/STRK20.
5. Confirm CCTP routes are unavailable on Mainnet and no Sepolia identity or inbox data appears.
