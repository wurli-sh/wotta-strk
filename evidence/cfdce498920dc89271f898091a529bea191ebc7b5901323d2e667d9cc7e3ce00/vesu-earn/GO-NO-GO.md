# Vesu Earn go/no-go — 2026-09-07

Decision: **GO — `vesuEarn.status` is `verified`.**

The exact pinned RC.2 Sierra/CASM artifacts were declared and deployed on
SN_MAIN. Live deposit+redeem smoke is receipt-verified. The independent
`REVIEW.md` admission gate was removed; smoke + source parity remain the
machine requirements for `pnpm check:vesu-earn`.

## Gated smoke pair (receipt-verified)

| Role | Tx |
| ---- | -- |
| Deposit 0.1 USDC | [0x066dc9…a82d8](https://voyager.online/tx/0x066dc916eed6d330729fdaf326b99cfeea7edae3e5bfe159591acddce04a82d8) |
| Redeem shares | [0x015802…a8d5f](https://voyager.online/tx/0x0158029dc3c11ef0d716eba72ac2d67235c9f521f1d80f2cf6a4c8a74e1a8d5f) |

`smoke.json` status is `complete`.

## Additional live deposit proofs

| Tx | Voyager |
| -- | ------- |
| 1 | [0x03ced3…d05f6](https://voyager.online/tx/0x03ced343209613b22dc8060d4a25f09cea29ad4e215c666f4fc6bae642fd05f6) |
| 2 | [0x05cbe6…35d1e](https://voyager.online/tx/0x05cbe60faee12a65ffa81c79059a71de33d22415d92dcc4a6f20eedd70e35d1e) |
| 3 | [0x07f159…0a201](https://voyager.online/tx/0x07f159448afe067a2b2ff8c680db14ec10002ed7061e0916e1f45ce773b0a201) |
