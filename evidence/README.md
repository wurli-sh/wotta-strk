# Evidence Layout

Phase 1 evidence is keyed by the deployment manifest hash so contract, wallet, and route artifacts stay tied to one exact mainnet manifest snapshot.

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
- `scripts/gates/phase1-check.ts` fails closed on missing required wallet smoke artifacts; the broader evidence tree itself remains optional until real live runs begin.
