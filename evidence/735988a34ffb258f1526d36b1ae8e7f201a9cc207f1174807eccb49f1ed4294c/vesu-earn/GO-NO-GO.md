# Vesu Earn go/no-go — 2026-09-06

Decision: **deployment GO; public Earn writes NO-GO**.

The exact pinned RC.2 Sierra/CASM artifacts were declared and deployed on
SN_MAIN. The live address has the expected class, and the pinned Vesu/USDC/
vUSDC/privacy-pool runtime tuple, protocol version/fee, decimals, and open-note
denylist probe all pass.

`vesuEarn.status` remains `pending`. Public deposit/redeem stays disabled until
an independent review is accepted and a wallet-allowlisted Ready smoke proves:
0.1 USDC deposit, private vUSDC discovery, exact-share redeem, private USDC
rediscovery, receipt mechanism, and zero anonymizer residue.

