# Evidence Layout

Phase evidence is keyed by the deployment manifest hash so wallet and route
artifacts stay tied to one exact network snapshot.

## Gate scope (no chicken-and-egg)

| Gate / command | Blocks |
|---|---|
| `pnpm contracts:preflight` / `contracts:declare` / `deploy:mainnet` | Fee, identity, RPC, artifacts only — **not** evidence |
| `pnpm check:phase1:sepolia` / `check:phase2:sepolia` | Testnet admission / Sepolia smoke |
| `pnpm check:phase1` / `check:phase3` (mainnet) | **Route admission after deploy** — real mainnet evidence |

Do **not** treat missing mainnet CCTP / Starknet-private evidence as a reason to
skip declare/deploy. Those summaries can only exist after the router and escrow
pools are on SN_MAIN.

Expected order: Sepolia green → declare/deploy mainnet → live smoke → evidence → admit.

Verified Mainnet destinations live in `deployments/mainnet.json` (router + 0.1/1 USDC
escrows). Do not fabricate evidence summaries; Phase 1/3 fail closed until real
transaction references exist under `evidence/<manifestHash>/`.

Expected layout:

```text
evidence/
  <manifest-hash>/
    phase1-wallet-api/
      smoke-session.json
      summary.json
      events.json
      source-session.sha256
    phase1-live-smoke/
      ...future orchestration outputs...
    cctp-<route-id>-sepolia/
      summary.json
    cctp-<route-id>-mainnet/
      summary.json
    starknet-private-mainnet/
      summary.json
    phase2-identity/
      checklist.json
      migrations.json
```

Rules:

- Never invent hashes, tx ids, balances, or receipts just to satisfy a gate.
- Wallet smoke evidence comes from a real Ready export and is materialized with `pnpm evidence:wallet-api -- <session.json>`.
- Contract/router/mainnet settlement evidence should be written under the same `<manifest-hash>` directory once live deploys and live smokes exist.
- Sensitive plaintexts do not belong here. Store decoded public evidence, command traces, summaries, and integrity digests instead.
- The production API image includes this directory because route admission reads the exact manifest-keyed summaries at startup. Treat every committed evidence file as public and run the redaction check before building the image.
- `summary.json` for an admitted CCTP route must bind the manifest, route/domain/source token, intent, burn transaction, Iris message and attestation digests, Starknet settlement transaction, router, denomination pool, claim hash, expiry, decoded router/pool events, and final indexed `funded` state.
- `phase2-identity/checklist.json` retains the four redacted identity scenarios; `migrations.json` retains the exact applied migration filenames and timestamp. Do not retain OAuth tokens, private keys, claim secrets, raw inbox data, messages, or attestations.
- `starknet-private-mainnet/summary.json` must bind the manifest hash, fixed denomination, public deposit transaction, escrow funded event, redacted encrypted-note delivery record, Ready/STRK20 claim transaction, and indexed claimed state. It must never contain the claim secret or decrypted note. Runtime admission requires `version: 1`, `network: "mainnet"`, `routeId: "starknet-private"`, the exact `manifestHash`, an approved `denomination`, the exact `escrowPool`, felt-shaped `depositTxHash` and `claimTxHash`, `encryptedNoteRecorded: true`, `finalIndexedState: "claimed"`, and `fundedEvent`/`claimedEvent` objects whose `escrow` and `denomination` match the verified pool. Missing or mismatched evidence makes `STARKNET_PRIVATE_ADMITTED=true` fail API startup.

## Current status

- Sepolia / testnet path: use `pnpm check:phase1:sepolia` (and phase 2 sepolia) for pre-deploy confidence.
- Mainnet contracts are live (`deployments/mainnet.json`); router is unpaused with Base/Solana domains admitted on-chain (see `docs/ROUTE_REVIEW_2026-09-05.md`).
- Mainnet `evidence/<hash>/` is still empty for committed admission summaries — Base has a verified on-chain claim observation in that review, but no redacted `cctp-base-mainnet/summary.json` is checked in yet. Starknet-native and Solana completed live flows remain unverified.
- Before enabling hosted `CCTP_ADMITTED_ROUTES` / `STARKNET_PRIVATE_ADMITTED`: materialize the summaries above from real flows, then redeploy the API.
