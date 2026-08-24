# Wotta production deployment

Wotta production is one Vercel web app backed by two fail-closed Render API services:

| Component | Origin | Network/processes |
| --- | --- | --- |
| Web | `https://wotta.vercel.app` | Shared UI and Testnet/Mainnet selector |
| Testnet API | `https://wotta-api-testnet.onrender.com` | `SN_SEPOLIA`, API + indexer + relayer |
| Mainnet API | `https://wotta-api-mainnet.onrender.com` | `SN_MAIN`, wallet-managed privacy API only |

The Mainnet service intentionally refuses indexer/relayer flags. Mainnet CCTP and Wotta escrow are out of scope; the shared UI continues to show those actions only in Testnet mode.

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
- `RUN_INDEXER=false`, `RUN_RELAYER=false`, `CCTP_ADMITTED_ROUTES=`

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

`render.yaml` is the infrastructure declaration. The first `pnpm deploy:env` creates missing services through the configured Render CLI. For existing Render services, compare their dashboard variables with the checklist before triggering a deploy; Render CLI currently does not update service environment variables.

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
4. Mainnet: connect Ready Mainnet, resolve a Mainnet-ready recipient, and preview the 0.1 USDC private send.
5. Confirm CCTP routes are unavailable on Mainnet and no Sepolia identity or inbox data appears.
