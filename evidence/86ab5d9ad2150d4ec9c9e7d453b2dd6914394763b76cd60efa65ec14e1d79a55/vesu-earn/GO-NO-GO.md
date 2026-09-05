# Vesu Earn go/no-go — 2026-09-05

Decision: **UI-only GO; Mainnet writes NO-GO**.

## Verified

- Wotta uses Ready Wallet API schema 0.10.3 and the vendored Starknet Privacy SDK RC.2.
- Exact anonymizer source: `PRIVACY-0.14.3-RC.2`, commit `9bfeb8dd35565a2915a0617dff3f649bd5bb891a`.
- Scarb 2.17.0 release build reproduced Sierra class hash `0x05932298db5e32106f6f5814db6f3c378472d9c0d8f0d8370c87f6f1fd311e2f`.
- SN_MAIN RPC verified code and pinned class hashes for the Prime pool, PoolFactory, native USDC, vUSDC, and Wotta privacy pool.
- `factory.v_token_for_asset(Prime, USDC)`, vToken `asset()`, `pool_contract()`, and 18 decimals match the manifest tuple.
- `convert_to_assets(1e18)` returned `1,014,500` USDC base units during this check.
- Vesu `/markets` returned the exact tuple as Prime and non-deprecated with browser CORS enabled.

## Blocking Mainnet writes

- The published compatibility matrix's Vesu anonymizer hash is RC.0, not RC.2. RC.2 changed redemption to `redeem(shares, ...)`.
- The published OpenZeppelin privacy audit scopes `packages/privacy/src`; the lending anonymizer is not listed.
- No fork proof exists for Wotta's exact private action shape against the pinned Vesu contracts.
- No Ready 0.10.3 proof exists for private vUSDC open-note creation, discovery, and later spend.
- The RC.2 anonymizer has not been declared/deployed on Mainnet; CASM, receipt, and address evidence are absent.
- No 0.1-USDC deposit/redeem smoke hashes exist.

Keep `deployments/mainnet.json#vesuEarn.status` set to `pending`. Do not deploy or change it to `verified` until every blocker above is dispositioned and the evidence is stored under the resulting manifest hash.
