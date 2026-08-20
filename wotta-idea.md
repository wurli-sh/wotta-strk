# Wotta

**Pay anyone, from any chain, to an `@handle` or email—and let them receive privately on Starknet.**

Wotta makes crypto payments feel like sending a message. A sender chooses a recipient identity instead of asking for a wallet address, funds the payment with USDC from a supported chain, and sends it to the recipient's Wotta inbox. The payment remains a one-time, refundable claim until the recipient accepts it. On acceptance, Wotta settles the funds into the recipient's shielded STRK20 balance on Starknet.

## Core flow

```text
Sender on any supported chain
        │
        │ USDC + @handle/email
        ▼
Cross-chain settlement to Starknet
        │
        ▼
Encrypted Wotta inbox claim (escrowed)
        │
        │ recipient accepts
        ▼
STRK20 privacy pool
        │
        ▼
Recipient's shielded balance
```

1. **Send** — enter an `@handle` or email, amount, and source chain.
2. **Fund** — Wotta routes USDC to Starknet, using CCTP or another verified route where required.
3. **Escrow and notify** — Wotta creates a protected, single-use inbox claim. Registered users receive an encrypted inbox item; new users receive an invite or bearer claim link. Unclaimed or expired payments can be refunded.
4. **Accept privately** — the recipient opens the claim, connects a Starknet wallet, and accepts the payment into STRK20.
5. **Spend privately** — the resulting shielded balance can be used for STRK20 private transfers and supported private actions until the recipient chooses to unshield.

## Two payment modes

### Standard mode: any chain → private recipient

The sender pays with normal USDC from a supported chain. Cross-chain funding and the STRK20 deposit are public, but the payment is delivered inside the pool so the recipient and their resulting shielded balance are hidden from public observers.

### Private mode: shielded sender → shielded recipient

The sender pays from an existing STRK20 shielded balance to an `@handle` or email. Wotta resolves the identity to a protected inbox destination and performs a private pool transfer. The sender, recipient, token, amount, and resulting balances remain private on-chain. This is the strongest Wotta flow because both sides stay inside the privacy pool.

## Privacy promise

Wotta is precise about its boundary:

- **Public:** source-chain funding, cross-chain burn/mint, STRK20 shielding, and eventual unshielding.
- **Private:** transfers within STRK20, including the sender-recipient link, amount, asset, and shielded balances.
- **Potentially correlatable:** matching deposits and withdrawals by amount and timing when the anonymity set is small.
- **Disclosable by design:** authorized users may selectively reveal activity through STRK20 viewing keys.

The honest product promise is: **“Send USDC from any supported chain and settle it into a private balance on Starknet.”** Wotta does not claim that the full cross-chain path is invisible.

## MVP

- `@handle` and email identity resolution
- USDC funding from Starknet plus one CCTP source chain
- Encrypted inbox, pending claims, expiry, and refunds
- Recipient acceptance directly into an STRK20 shielded balance
- Private payments from one shielded Wotta user to another
- Gas-sponsored claim transactions and clear public/private status in the UI

Wotta combines Sable's message-like inbox payment flow with Swoop's private spending balance, using Starknet and STRK20 as the shared settlement and privacy layer.
