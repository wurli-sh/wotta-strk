# Confidential-source prerequisite

Batching alone does not hide source deposit amounts. A plain vault still shows each user’s USDC transfer.

Until each activated source has a **reviewed mainnet** primitive, the only permitted claim is **improved source-to-destination unlinkability**, not source-amount confidentiality.

| Source | Unanswered question |
| --- | --- |
| Base | What reviewed mainnet primitive keeps the deposited amount out of ERC-20 transfer calldata/events/state while preserving redeemable native-USDC backing? |
| Solana | What reviewed mainnet primitive keeps SPL-USDC deposit amounts confidential and remains composable with Circle’s CCTP program? |
| Starknet | How does the chosen STRK20/Ready flow receive committed allocations and keep its documented privacy guarantees? |

Do not market TEE, encrypted-amount, mixer, or anonymity claims without those answers.
