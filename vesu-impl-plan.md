# Vesu shielded-USDC earn integration plan

Status: audited and resynced; fail-closed frontend implementation is ready, Mainnet writes remain blocked
Research date: 2026-09-05 (Asia/Kathmandu)  
Repository baseline inspected: `ffd7f7f` plus the current uncommitted worktree  
Target product path: successful private claim → optional earn prompt → Account / Earn → shielded USDC supplied to Vesu

## 0. Audit decision (2026-09-05)

The proposal is internally sound only when implementation and release are treated as separate gates. Schema, transaction builders, position reads, Account/Earn UI, and the post-claim route may be implemented now behind a fail-closed manifest. The product must not expose a Mainnet deposit or redeem transaction until the anonymizer is deployed, independently reviewed, exercised through Ready, and backed by recorded deposit/redeem evidence.

| Gate | Audit result | Evidence / consequence |
| --- | --- | --- |
| Wotta SDK pin | Pass | Web and wallet-smoke use `@starkware-libs/starknet-privacy-sdk` `PRIVACY-0.14.3-RC.2`. |
| Exact anonymizer source | Pinned | `PRIVACY-0.14.3-RC.2`, commit `9bfeb8dd35565a2915a0617dff3f649bd5bb891a`. |
| Reproducible RC.2 Sierra class hash | Pass | Release build with Scarb 2.17.0 reproduced `0x05932298db5e32106f6f5814db6f3c378472d9c0d8f0d8370c87f6f1fd311e2f`. Record the CASM hash during declaration as well. |
| Published compatibility hash | Not usable for RC.2 | The compatibility matrix pins the Vesu anonymizer contract to `PRIVACY-0.14.3-RC.0`, class hash `0x3751128dc3ebd36215f982766f14aaca8f78793e4b0f42a73e49372a8e24aae`. RC.2 changed redemption from asset-based `withdraw` to share-based `redeem`; do not copy the RC.0 hash into the RC.2 deployment row. |
| Prime native-USDC tuple | Pass at audit time | SN_MAIN RPC returned the pinned vToken from `factory.v_token_for_asset`; vToken `asset`, `pool_contract`, and decimals matched; Vesu API reported the exact market as Prime and non-deprecated. |
| Observed Mainnet class hashes | Pinned for drift checks | Factory `0x5041cc424410e1a63e4f3ef7d65ab3115f19eabb2d45418e7ac245df011d994`; pool `0x317ce57b2de4a0c482f0eed58a635d100ac5b4801b38251607dcfa35a4128`; vToken `0x41b16e0ca0565a58d1379ffc3c7eab7459b382ba8f8208b3b87d18d2aed4f78`; USDC `0x78a357382d29a07ab7e32c5ce3ffae20021abee67c353b8885737b1d643eac9`; privacy pool `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`. |
| Exchange-rate read | Pass | `convert_to_assets(1e18)` returned `1,014,500` USDC base units at the audit read, proving shares must be handled at 18 decimals and underlying at 6. |
| Vesu API browser access | Pass at audit time | `/markets` returned `Access-Control-Allow-Origin: *`; it remains display-only and non-authoritative. |
| Privacy audit coverage | Blocked | The published OpenZeppelin scope lists `packages/privacy/src` only; it does not cover `packages/vesu_lending_anonymizer`. Independent review remains mandatory. |
| Fork + Ready vUSDC discovery/spend | Blocked | No recorded proof yet for the exact Wotta Mainnet action shape and Ready Wallet API 0.10.3. |
| Anonymizer declaration/deployment/smoke | Blocked | No Mainnet address or transaction evidence exists. `vesuEarn.status` must remain `pending`. |

Locked product decisions after audit:

- Deploy the exact upstream stateless RC.2 anonymizer; no Wotta wrapper in v1.
- Mainnet only. Sepolia may explain that Earn is unavailable but must never construct a Vesu write or show the post-claim Earn prompt.
- Deposit allowlist is exactly 0.1 and 1 USDC and must intersect the wallet-managed privacy allowlist.
- `verified` enables deposit and redeem; `withdraw_only` disables deposit while preserving redeem; `pending` disables all writes.
- Vesu API is browser/display-only. No rewards UI in v1.
- The post-claim prompt opens only when the runtime `canDeposit` gate passes; accepting only routes to `/account?tab=earn`.
- P&L is a local, device-bound estimate from confirmed transactions only. Missing local basis renders current value without a fake zero return.

## 1. Outcome

Add a third Account tab, **Earn**, at `/account?tab=earn`. A user can move shielded native USDC from Wotta's Starknet privacy pool into one curated Vesu V2 USDC market without first exposing the USDC as a public wallet balance. In return, the user receives the market's vUSDC shares as a private STRK20 note. The same tab lets the user redeem private vUSDC shares back into a private USDC note.

After a claim succeeds, show an optional dialog styled and behaved like the existing reconnect-wallet dialog:

> **Put your USDC to work?**  
> Your claimed USDC is now in your private balance. You can supply it to Vesu to earn a variable rate. Vesu activity and the amount supplied are visible onchain.

Actions:

- Primary: **Earn on Vesu** → `/account?tab=earn`
- Secondary: **Not now** → close the dialog and leave the existing claimed state visible
- Close/Escape/backdrop → same as **Not now**

The dialog must not auto-deposit, auto-route, or imply guaranteed yield. The Vesu transaction happens only after a second, explicit amount review and Ready approval on the Earn tab.

## 2. Key decisions

1. **Integrate Vesu V2 through its ERC-4626/SNIP-22 vToken, not through `Pool.manage_position`.** Vesu documents the vToken as the simple lender integration: `deposit(assets, receiver)` mints shares and `redeem(shares, receiver, owner)` returns underlying assets.
2. **Use the Starknet Privacy Vesu lending anonymizer.** Its atomic flow is private USDC note → anonymizer → Vesu vUSDC → private vUSDC note. Redemption reverses that path.
3. **Launch Mainnet-first.** Wotta Mainnet uses native Circle USDC, which matches Vesu's native-USDC markets. Wotta Sepolia currently uses a different test USDC and a direct-SDK privacy stack; it does not automatically map to a real-yield Vesu market. Never show a working Earn CTA on Sepolia until a compatible test vToken/anonymizer deployment exists.
4. **Curate one market initially.** Use the native-USDC vToken in Vesu's **Prime** V2 pool, which the live Lite application currently selects as its Mainnet default pool. Do not dynamically choose whichever pool has the highest APY.
5. **Keep position state client/onchain-derived.** Read private vUSDC shares from Ready and value them through the vToken's onchain `convert_to_assets`. Do not write private balances, share counts, or claim-to-deposit links to Wotta's API/database.
6. **Treat the Vesu API as display-only.** APY, utilization, TVL, and market labels may come from `https://api.vesu.xyz/markets`, but addresses and transaction admission must come from Wotta's verified deployment manifest and onchain checks.
7. **Do not promise incentive rewards in v1.** The vToken docs say deposits earn interest and rewards like ordinary pool deposits, but private-pool custody can change who can claim separately distributed incentives. Ship only the exchange-rate/base-yield position until reward ownership is proven end to end.

## 3. What exists today

### Wotta

- `apps/web/src/features/account/AccountPage.tsx` has URL-backed `handles` and `wallet` tabs. Unknown tab values currently fall back to Handles.
- `apps/web/src/components/account/WalletAndBalancePanel.tsx` reveals private USDC:
  - Mainnet through Ready Wallet API `account.strk20Balances(...)`.
  - Sepolia through the vendored direct Privacy SDK and discovery service.
- `apps/web/src/components/claim/ClaimView.tsx` owns the successful-claim transition. It sets `phase = "complete"`, displays the claimed card, fires confetti, and invalidates private-balance readers. Its current primary success CTA goes to `/account?tab=wallet`.
- `apps/web/src/components/NetworkWalletReconnectPrompt.tsx` is the visual/interaction reference for the requested dialog: `AnimatePresence`, fixed backdrop, `role="dialog"`, `aria-modal`, close button, two actions, reduced-motion support, and a separate wallet modal.
- `apps/web/src/lib/wotta/mainnet-privacy.ts` already constructs and submits Ready `STRK20_ACTION[]`, requires a simulated preview, verifies that Ready targets the pinned privacy pool, waits for the receipt, and supports the `${openNoteIds[N]}` placeholder through an `invoke` action.
- Mainnet native USDC is already pinned as `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb`.
- Mainnet private actions are currently amount-allowlisted to 0.1, 1, 10, 50, and 100 USDC. Keep the first Vesu release inside a reviewed allowlist rather than adding arbitrary amounts immediately.
- The README and brand copy already promise “Earn on Vesu”, but there is no Vesu transaction implementation or Earn tab.
- Mainnet Claim is admitted only through the verified, network-scoped deployment row. The post-claim prompt remains independently gated by `vesuEarn.status === "verified"`; a working claim must never imply that Earn is admitted.

### Vesu V2 and the selected market

Vesu V2 creates one ERC-4626/SNIP-22 vToken for each `(pool, asset)` pair. Depositing native USDC into the selected vToken mints 18-decimal vUSDC shares; interest appears as an increasing underlying-assets-per-share exchange rate. The share balance is not itself a 6-decimal USDC balance.

Proposed pinned Mainnet tuple:

| Item | Value |
| --- | --- |
| Network | Starknet Mainnet (`SN_MAIN`) |
| Vesu version | V2 |
| Pool | Prime |
| Pool address | `0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5` |
| Underlying | Native USDC |
| USDC address | `0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` |
| vToken | Vesu USD Coin (`vUSDC`) |
| vToken address | `0x00387e8ddbb1ab36ca08874d9abc702ef4872ad600dcf76b7f240b71d7bc4e65` |
| vToken decimals | 18 |
| Vesu factory | `0x03760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0` |
| Vesu market page | `https://vesu.xyz/lite/markets/0x0451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5/0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb` |

Live checks performed during research:

- Vesu's API returned the tuple above as active and non-deprecated.
- The PoolFactory's onchain `v_token_for_asset(Prime, native USDC)` returned the proposed vToken.
- The vToken's `asset()` returned native USDC and `pool_contract()` returned Prime.
- The vToken has 18 decimals. At the sampled block, `convert_to_assets(1e18 shares)` returned `1,014,433` native-USDC base units; this is an example of why shares and USDC must never be formatted with the same decimals.
- The live API snapshot showed about 3.576% supply APY and 83.67% utilization for Prime native USDC. These are volatile observations, not product constants or promises.

The Vesu Lite application's default pool is a frontend choice and can change. Wotta must pin and review its own market tuple even if it begins with the same Prime market.

## 4. Private Vesu transaction design

### 4.1 Required anonymizer

The upstream `VesuLendingAnonymizer` is called by the privacy pool through `privacy_invoke`. Its constructor has no arguments. It:

- accepts a deposit or withdraw operation;
- approves and calls the supplied vToken;
- measures the actual output-token balance delta;
- approves the calling privacy pool to collect that output; and
- returns one `OpenNoteDeposit(note_id, out_token, out_amount)`.

The upstream compatibility table lists `0x3751128dc3ebd36215f982766f14aaca8f78793e4b0f42a73e49372a8e24aae` as the **RC.0 class hash**, not a deployed anonymizer address and not the RC.2 artifact Wotta uses. RC.2 commit `9bfeb8dd35565a2915a0617dff3f649bd5bb891a` reproducibly builds Sierra class hash `0x05932298db5e32106f6f5814db6f3c378472d9c0d8f0d8370c87f6f1fd311e2f`. Implementation includes RC.2 declaration and deployment and must never paste either class hash into the runtime address field.

The anonymizer calldata serializes its `u256 amount` as low/high felts:

```text
[operation, in_token, out_token, amount_low, amount_high, open_note_id]
```

The vendored SDK README's unlend example withdraws `vTokenAmount` but passes `lendAmount` in the invocation. The contract implementation clearly calls `redeem(shares = amount, ...)`; Wotta must pass the exact **share amount** in both places. Add a regression test for this because copying the example literally can strand a withdrawal behind a revert.

### 4.2 Deposit: private USDC → private vUSDC

Build one atomic Ready action list:

```ts
[
  { type: "withdraw", token: USDC, amount: usdcAmount, recipient: VESU_ANONYMIZER },
  { type: "transfer", token: VUSDC, amount: "OPEN", recipient: readyAccount },
  {
    type: "invoke",
    contract: VESU_ANONYMIZER,
    calldata: ["0x0", USDC, VUSDC, amountLow, amountHigh, "${openNoteIds[0]}"],
  },
]
```

Execution order:

1. Ready selects private USDC notes and creates private change.
2. The privacy pool releases exactly `usdcAmount` to the anonymizer.
3. The anonymizer deposits USDC into the pinned Vesu vToken.
4. The vToken mints shares to the anonymizer.
5. The anonymizer returns the actual minted share amount to the open vUSDC note.
6. The privacy pool records the vUSDC note for the user.

Before submission:

- ensure the connected Ready address equals the Wotta-linked address;
- require Mainnet and the verified earn manifest;
- verify amount is positive, within private USDC balance, and allowlisted;
- run `strk20PrepareInvoke(actions, true)`;
- require the resulting call target to equal Wotta's pinned privacy pool;
- show an explicit Ready approval step; and
- tolerate proof generation as a long-running wallet call.

### 4.3 Redeem: private vUSDC → private USDC

Build the reverse atomic action list:

```ts
[
  { type: "withdraw", token: VUSDC, amount: shareAmount, recipient: VESU_ANONYMIZER },
  { type: "transfer", token: USDC, amount: "OPEN", recipient: readyAccount },
  {
    type: "invoke",
    contract: VESU_ANONYMIZER,
    calldata: ["0x1", VUSDC, USDC, sharesLow, sharesHigh, "${openNoteIds[0]}"],
  },
]
```

The first release should redeem exact shares, with presets **25% / 50% / Max**, and show an onchain `convert_to_assets(shares)` estimate. Do not label the estimate as guaranteed. The anonymizer uses `redeem`, so the received USDC can change slightly between quote and inclusion. `Max` should use the latest private vUSDC balance, never a cached value.

Withdrawal must remain available when the Vesu stats API is down. If the Vesu pool is paused, illiquid, or its oracle is invalid, explain the Vesu revert and keep the position visible for retry; do not hide it.

### 4.4 Privacy statement

This flow preserves the proceeds as a private note; it does not make the Vesu interaction invisible. The invoked anonymizer, selected market/token addresses, operation, supplied amount, transaction timing, and submitting/paymaster account metadata can be public. The Earn UI and post-claim prompt must say this plainly. Never use “fully private yield” or imply that the Vesu deposit cannot be correlated.

## 5. Deployment manifest and fail-closed admission

Seed a `vesuEarn` object in `deployments/mainnet.json` as `pending` so every consumer has one typed, fail-closed source of truth. Deployment scripts fill the anonymizer address/receipt fields, and only the evidence-backed admission step may change status to `verified`:

```json
{
  "status": "pending",
  "network": "SN_MAIN",
  "protocolVersion": "V2",
  "marketSource": "Vesu Prime native-USDC vToken",
  "poolAddress": "0x0451...c3b5",
  "poolClassHash": "<observed and pinned>",
  "factoryAddress": "0x03760...88c0",
  "factoryClassHash": "<observed and pinned>",
  "underlyingAddress": "0x033068...35fb",
  "underlyingDecimals": 6,
  "vTokenAddress": "0x00387...4e65",
  "vTokenClassHash": "<observed and pinned>",
  "vTokenDecimals": 18,
  "anonymizerAddress": "UNDEPLOYED",
  "anonymizerClassHash": "<reproduced Sierra class hash>",
  "anonymizerCompiledClassHash": "PENDING",
  "privacyPoolAddress": "0x040337...812a",
  "allowedDepositAmounts": ["100000", "1000000"],
  "verifiedAtBlock": "<block>",
  "verificationNotes": "<source commits, RPC checks, smoke txs>"
}
```

Start with 0.1 and 1 USDC during smoke/beta. Expand denominations only after successful deposit and full/partial redeem evidence.

Extend deployment verification/preflight to fail unless all of these hold onchain:

- expected chain ID and nonzero code/class hashes;
- Vesu `factory.v_token_for_asset(pool, underlying) == vToken`;
- vToken `asset() == underlying`;
- vToken `pool_contract() == pool`;
- vToken decimals are 18 and underlying decimals are 6;
- privacy pool and native-USDC addresses equal Wotta's existing verified Mainnet privacy row;
- anonymizer class hash equals the reviewed artifact;
- Vesu pool is not deprecated in the curated config and deposit/redeem previews do not revert;
- a simulated Ready action targets only the pinned privacy pool; and
- successful tiny deposit plus redeem transaction hashes are captured in evidence.

Runtime deposit must fail closed unless `vesuEarn.status === "verified"`. Runtime redeem is allowed only for `verified` or `withdraw_only`, with a live deployed anonymizer and a positive private vUSDC balance. The Account tab may explain a pending state and perform safe reads, but must not offer a write action.

## 6. Frontend implementation

### 6.1 Account / Earn tab

Change `AccountTab` to `"handles" | "wallet" | "earn"`, add `{ value: "earn", label: "Earn" }`, parse `?tab=earn`, and preserve the existing legacy redirects for `balance` and `identity`.

Create `apps/web/src/components/account/EarnPanel.tsx` with these states:

1. **Unsupported network** — on Sepolia, explain that real Vesu yield is Mainnet-only; provide the network switch, no fake action.
2. **Signed out / wallet unlinked** — route to the existing account connection flow.
3. **Locked** — “Unlock Ready to view private USDC and vUSDC.”
4. **Loading** — skeleton for balances, rate, and position.
5. **Available, no position** — private USDC balance, variable APY, curated pool, amount presets, risk/privacy disclosure, and **Start earning**.
6. **Active position** — private vUSDC shares, current USDC-equivalent value, live variable APY, Vesu market link, and **Withdraw**.
7. **API degraded** — balances and withdraw remain usable; APY says unavailable/stale.
8. **Transaction running** — phases such as Connecting Ready, Simulating, Authorize in Ready, Generating proof, Confirming, Refreshing position.
9. **Success/error** — toast plus refreshed balances; success includes explorer link. Errors stay actionable and do not erase the last good position.

Suggested copy:

- Title: **Earn on private USDC**
- Supporting line: **Supply to Vesu Prime and receive private vUSDC shares. The rate is variable.**
- Disclosure: **Your resulting vUSDC balance remains shielded, but the Vesu action, market, amount, and timing are visible onchain.**
- Rate label: **Current variable supply APY**
- Value label: **Current value** rather than **Earned**, unless a trustworthy cost basis is later designed.

Do not calculate “profit” as current value minus the current private USDC balance. Exact lifetime earnings require deposit/redemption cost basis, which the protocol does not expose from the current share balance alone. A later local-only ledger may estimate earnings, but it must be labeled as an estimate and must survive note consolidation/redemption correctly.

### 6.2 Post-claim dialog

Create `apps/web/src/components/claim/EarnAfterClaimDialog.tsx` rather than coupling this prompt to `NetworkWalletReconnectPrompt` state. Reuse its layout tokens and accessibility behavior.

Mount it from `ClaimView` after the claim receipt succeeds. Recommended state sequence:

1. Set the existing claim success state.
2. Fire balance invalidation and confetti.
3. If `canEarn(mode, claimedToken, manifest)` is true, open the dialog.
4. **Earn on Vesu** closes it and calls `router.push("/account?tab=earn")`.
5. **Not now** closes it and leaves the existing claim-success card on screen.

Do not include the private claim amount or note ID in the URL. The Earn tab should re-read the latest private USDC balance after Ready authorization. Show the prompt once per successful claim component lifecycle; dismissal need not be persisted globally.

Because Claim is currently blocked on Mainnet, wire the component now but keep the prompt behind the verified `canEarn` check. For Sepolia, either omit the prompt or say “Vesu Earn is available on Mainnet” without a deposit CTA. Enable the full prompt automatically when Mainnet claims become admitted.

### 6.3 Market stats

Create a narrow `apps/web/src/lib/vesu/market.ts` adapter that:

- fetches `https://api.vesu.xyz/markets` with a timeout;
- selects only the manifest-pinned pool and native-USDC address;
- validates the minimum response shape and decimal fields;
- converts fixed-point APY/utilization using integer-safe helpers;
- caches briefly in memory and records `updatedAt`;
- marks stats stale after a defined interval; and
- never returns addresses for transaction construction.

If browser-side reliability becomes poor, add a read-only Next route with short caching. Do not add Vesu data to the authenticated Wotta API unless operational need justifies it.

## 7. Code map

Expected additions:

- `apps/web/src/components/account/EarnPanel.tsx`
- `apps/web/src/components/claim/EarnAfterClaimDialog.tsx`
- `apps/web/src/lib/vesu/config.ts`
- `apps/web/src/lib/vesu/actions.ts`
- `apps/web/src/lib/vesu/market.ts`
- `apps/web/src/lib/vesu/position.ts`
- corresponding Vitest files
- an anonymizer artifact/deployment script or a pinned upstream source package under `contracts/`
- deployment verification and smoke evidence documentation

Expected edits:

- `apps/web/src/features/account/AccountPage.tsx` — third URL-backed tab and `EarnPanel`
- `apps/web/src/components/claim/ClaimView.tsx` — post-success dialog trigger and route
- `apps/web/src/lib/wotta/mainnet-privacy.ts` — expose/reuse the verified generic STRK20 submit path or move it into a shared internal helper
- `apps/web/src/lib/brand-copy.ts` — honest Earn, risk, phase, success, and error copy
- `apps/web/src/components/ui/Skeleton.tsx` — Earn skeleton
- `deployments/mainnet.json` — verified Vesu tuple and anonymizer deployment
- `contracts/scripts/mainnet-preflight.ts`, `contracts/scripts/verify.ts`, and phase gates — Vesu admission checks
- `.env.example` and deployment sync only if RPC/build inputs are truly needed; runtime contract addresses should come from the manifest
- `README.md`, `docs/SECURITY.md`, `docs/dependencies.md`, and evidence docs — implemented behavior and privacy/security boundary
- `apps/web/e2e/smoke.spec.ts` — tab routing, network gating, post-claim prompt, and no-write fail-closed assertions

Refactor `submitMainnetPrivacyActions` carefully. It currently has valuable invariants but is private to `mainnet-privacy.ts`. Reuse it through a small reviewed abstraction; do not duplicate a weaker Vesu-only submitter.

## 8. Testing and evidence

### Unit tests

- exact deposit action ordering and exact six-felt anonymizer calldata;
- exact redeem action ordering;
- u256 low/high encoding, including values above `u128` even if UI values are smaller;
- redeem uses share amount in both private withdrawal and anonymizer calldata;
- only manifest-pinned addresses are accepted;
- 6-decimal USDC versus 18-decimal vUSDC formatting;
- `convert_to_assets` response decoding;
- insufficient balance, zero, over-allowlist, wrong network, stale operation, and abort paths;
- stats parser handles missing/failed entries and never mutates transaction config;
- account `?tab=earn` parsing and legacy tab redirects;
- prompt open/dismiss/primary navigation and keyboard behavior;
- no prompt when Earn is unavailable for the active network/token.

### Component/E2E tests

- signed-out and unlinked-wallet Earn states;
- Mainnet locked, empty, active-position, degraded-API, busy, success, and error states;
- Sepolia renders no active Vesu write button;
- successful eligible claim opens the dialog only after receipt success;
- **Not now** preserves the claimed card;
- **Earn on Vesu** routes exactly to `/account?tab=earn`;
- dialog has `role="dialog"`, `aria-modal`, labelled title, focus handling, Escape/backdrop close, and reduced-motion behavior;
- network switching or wallet reconnect cancels stale async work;
- stats failure does not disable redemption;
- unverified manifest never mounts **Start earning** or **Withdraw** writes.

### Contract/integration tests

- build the exact pinned anonymizer source and reproduce the expected class hash;
- test deposit/redeem against Vesu V2 contracts and the privacy pool on a fork before Mainnet;
- prove no residual USDC or vUSDC remains in the anonymizer after success;
- prove the returned open note token and measured amount are correct;
- exercise non-1:1 share exchange rates;
- exercise zero output, malicious/wrong vToken, paused pool, insufficient liquidity, failed allowance, rounding, and replay/revert behavior;
- validate atomicity: if Vesu deposit/redeem or open-note collection fails, the private input is not consumed;
- Mainnet beta smoke: 0.1 USDC deposit, private vUSDC discovery, partial or full redemption, private USDC rediscovery, and explorer evidence.

## 9. Security and product release gates

Do not enable Mainnet writes until all gates pass:

- [ ] Review the exact Vesu V2 deployed class/commit against its published V2 audits.
- [ ] Independently review/audit the Vesu lending anonymizer. The published OpenZeppelin Starknet Privacy audit scoped `packages/privacy/src`; it did **not** list `packages/vesu_lending_anonymizer`.
- [ ] Pin the anonymizer source commit and reproducible Sierra/CASM class hashes.
- [ ] Declare/deploy the anonymizer and record address, class hash, tx hash, deployer, and block.
- [ ] Confirm the Mainnet privacy pool permits and correctly executes this invoke flow through Ready Wallet API 0.10.3.
- [ ] Confirm Ready can discover and spend the selected private vUSDC token.
- [ ] Confirm Vesu Prime's pool/vToken tuple onchain and in Vesu's current curated frontend.
- [ ] Threat-model a malicious or replaced Vesu API response; it must affect display only.
- [ ] Verify deposit/redeem rounding and dust behavior at 0.1 and 1 USDC.
- [ ] Verify withdrawals under high utilization and document that liquidity can be temporarily unavailable.
- [ ] Confirm whether STRK/DeFi Spring rewards accrue, who owns the claim, and whether they are recoverable. Hide reward claims until proven.
- [ ] Add monitoring for pool/vToken/anonymizer class-hash drift, pool pause state, API freshness, and deposit/redeem failures.
- [ ] Add a kill switch by changing `vesuEarn.status` through the existing deployment/admission process; disabling deposits must not remove the emergency withdrawal path without an explicit incident decision.
- [ ] Update privacy copy and risk disclosures before enabling the CTA.

Risks users must be told about:

- variable and non-guaranteed APY;
- smart-contract risk across Wotta privacy, anonymizer, Vesu vToken, and Vesu pool;
- curated-pool/curator, collateral, oracle, upgrade, and pause risk;
- liquidity risk when borrowers use most supplied USDC;
- private-proof, Ready wallet, discovery, and proving-service availability;
- public visibility/correlation of the Vesu action metadata;
- third-party API data can be stale or unavailable; and
- vUSDC is a share token whose USDC value changes over time.

## 10. Delivery phases

### Phase A — prove compatibility

1. Pin upstream anonymizer and Vesu V2 commits.
2. Fork-test the anonymizer with the exact Wotta privacy pool action shape and Prime vUSDC.
3. Confirm Ready Wallet API accepts vUSDC open-note creation and later discovery/spend.
4. Resolve reward ownership and audit coverage.
5. Produce a go/no-go note. Stop here if Ready rejects the action or the anonymizer cannot be made reviewable.

### Phase B — deploy and admit

1. Reproducibly build, declare, and deploy the reviewed anonymizer.
2. Extend the Mainnet manifest and verification scripts.
3. Execute tiny Mainnet deposit/redeem smokes.
4. Mark `vesuEarn.status = "verified"` only after recorded evidence passes.

### Phase C — frontend MVP

1. Add Earn tab routing and network/manifest gates.
2. Add private USDC and vUSDC balance reads.
3. Add pinned market stats and onchain share valuation.
4. Add 0.1/1-USDC deposit and percentage-based redeem flows.
5. Add post-claim prompt with explicit opt-in routing.
6. Add unit, component, and E2E coverage.

### Phase D — hardening and release

1. Security review the final diff and deployed artifacts.
2. Run failure drills for Vesu API outage, pool pause, low liquidity, Ready rejection, and network switch.
3. Add observability without logging private balances or correlating claim IDs to Vesu transactions.
4. Beta with the small denomination allowlist.
5. Expand amounts only after deposit and redemption telemetry/evidence is healthy.

## 11. Acceptance criteria

- `/account?tab=earn` selects a real third Account tab and survives refresh/back/forward navigation.
- An eligible Mainnet user can authorize a private-USDC deposit into the pinned Vesu V2 Prime vUSDC and later see a private vUSDC balance.
- The user can redeem vUSDC back to a private native-USDC note without publicly withdrawing to their wallet first.
- Every write uses only manifest-pinned addresses, runs a Ready simulation, and fails closed on network/config mismatch.
- APY is labeled variable, timestamped/stale-aware, and never hardcoded.
- Current position value is computed from private share balance plus onchain vToken conversion, with correct token decimals.
- After an eligible successful claim, the earn dialog appears; dismissal preserves claim success, and acceptance routes to `/account?tab=earn` without initiating a transaction.
- No Vesu write is offered on the current Sepolia setup.
- Vesu API failure cannot block redemption.
- No server/database log contains private USDC/vUSDC balances or a claim-to-earn correlation record.
- Mainnet enablement has reproducible anonymizer artifacts, an independent review result, onchain verification, and successful deposit/redeem evidence.

## 12. Resolved decisions and remaining blockers

The five former product decisions are resolved by the locked choices in section 0: exact upstream RC.2 contract, no Sepolia writes, 0.1/1-USDC beta, prompt only after `canDeposit`, and no rewards.

Remaining blockers are evidence, not product ambiguity:

1. independent review of the exact RC.2 anonymizer source and compiled artifacts;
2. fork proof against the exact Wotta action shape and pinned deployed Vesu classes;
3. Ready 0.10.3 proof for private vUSDC creation, discovery, and spend;
4. Mainnet declaration/deployment with Sierra/CASM and receipt evidence; and
5. a 0.1-USDC deposit/redeem smoke before changing `vesuEarn.status` from `pending`.

## 13. Sources

Primary sources used for this plan:

- [Vesu Lite markets](https://vesu.xyz/lite/markets)
- [Vesu: Lite mode](https://docs.vesu.xyz/user-guides/lite-mode)
- [Vesu: How to Earn](https://docs.vesu.xyz/user-guides/earn)
- [Vesu V2: supply and withdraw](https://docs.vesu.xyz/developers/interact/supply-withdraw)
- [Vesu V2: vToken contract](https://docs.vesu.xyz/developers/core/vtoken)
- [Vesu V2: PoolFactory and vToken lookup](https://docs.vesu.xyz/developers/core/pool-factory)
- [Vesu V2 contract addresses](https://docs.vesu.xyz/developers/contract-addresses)
- [Vesu risk guide](https://docs.vesu.xyz/user-guides/manage-risks)
- [Vesu audit overview](https://docs.vesu.xyz/security/audits)
- [Vesu V2 source](https://github.com/vesuxyz/vesu-v2)
- [Starknet Privacy SDK anonymous-lending example, pinned Wotta SDK tag](https://github.com/starkware-libs/starknet-privacy/blob/PRIVACY-0.14.3-RC.2/sdk/README.md#anonymous-lending-vesu)
- [Vesu lending anonymizer source and interface](https://github.com/starkware-libs/starknet-privacy/tree/PRIVACY-0.14.3-RC.2/packages/vesu_lending_anonymizer)
- [Starknet Privacy compatibility table at the pinned tag](https://github.com/starkware-libs/starknet-privacy/blob/PRIVACY-0.14.3-RC.2/README.md#compatibility-matrix)
- [Starknet Privacy audit scope](https://github.com/starkware-libs/starknet-privacy/tree/main/docs/audit)
- [Live Vesu market API](https://api.vesu.xyz/markets) — informational stats/metadata snapshot only

All addresses must be rechecked against onchain state and the current official sources immediately before deployment. Live APY/utilization values in this document are research snapshots and must not be copied into product constants.
