# Vesu Earn Mainnet smoke

`deployments/mainnet.json#vesuEarn.status` is **`verified`** (manifest hash
`cfdce498…`). Production Earn deposit/redeem is allowed for linked Ready wallets
on Mainnet. Use this runbook for **regression** smoke or to refresh evidence
under a new manifest hash.

Run only with the exact Ready Mainnet account linked to the Wotta profile.

1. Optional local-only pending override (ignored in production builds):

   ```env
   NEXT_PUBLIC_VESU_EARN_SMOKE_WALLET=0x...
   ```

2. Fully restart `pnpm dev` (or use https://wotta.vercel.app on Mainnet). Open
   Account → Earn, reveal the private balance, choose 0.1 USDC, approve the
   deposit in Ready, and retain the transaction hash. Confirm the resulting
   private vUSDC position appears.
3. Redeem Max, retain that transaction hash, and confirm private USDC appears
   again.
4. Materialize receipt-verified, redacted evidence:

   ```bash
   VESU_SMOKE_DEPOSIT_TX_HASH=0x... \
   VESU_SMOKE_REDEEM_TX_HASH=0x... \
   VESU_SMOKE_PRIVATE_VUSDC_DISCOVERED=1 \
   VESU_SMOKE_PRIVATE_USDC_REDISCOVERED=1 \
   pnpm evidence:vesu-smoke
   ```

   The recorder derives the exact redeemed share amount from the privacy-pool
   Withdrawal event, reconstructs both mechanisms, and checks USDC/vUSDC
   anonymizer residue at each receipt block.

5. Remove `NEXT_PUBLIC_VESU_EARN_SMOKE_WALLET` if set, restart the dev server, and
   run `pnpm check:vesu-earn`. The gate prints `admit verified` when source
   parity, smoke receipts, and live RPC checks all pass.
