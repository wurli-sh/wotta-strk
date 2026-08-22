# Direct STRK20 route on Sepolia

Wotta's Sepolia smoke application uses Ready X for public funding/deployment
transactions and as the SNIP-12 signer while the direct Starknet Privacy SDK handles registration,
note discovery, and proof construction. This route exists because a fresh Ready
Sepolia account cannot initialize privacy through Wallet API `0.10.3` alone.
The mainnet product route remains wallet-managed.

## Compatible components

| Component | Sepolia value |
| --- | --- |
| Privacy pool | `0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91` |
| Pool class hash | `0x056ab118a8a6e38efc93ad758cefe909fee421fa931ce3cf72df624d345623b2` |
| Privacy identity class | `0x017be2d66359f439b734eafce8eb23df46e2baaa937aa7f67d5ffd2ebf000af6` |
| Native test USDC | `0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343` |
| Proof-aware RPC | `https://starknet-sepolia-rpc.publicnode.com` (RPC `0.10.2`) |
| Prover | `https://transaction-prover.alpha-sepolia.sw-dev.io` |
| Discovery | `https://discovery-service.alpha-sepolia.sw-dev.io` |

The browser calls the two services through Vite's same-origin
`/privacy/prover` and `/privacy/discovery` proxies. No prover VM or private API
key is needed for the local Sepolia smoke.

The direct route requires a proof-aware Starknet RPC at version `0.10` or
newer. Older endpoints can accept `proof` and `proof_facts` fields while still
estimating or hashing them incorrectly, producing misleading
`EMPTY_PROOF_FACTS` or `Account: invalid signature` failures. The local
submitter rejects those endpoints before signing.

The pool also charges a protocol fee in STRK from the outer submitter. The
local test submitter checks its STRK allowance and performs a one-time maximum
approval for the pinned pool before sending the first proof transaction.

## Identity and key custody

Ready's injected account cannot sign the raw proof invocation expected by the
direct SDK. Wotta therefore deploys the already-declared PriPay compatibility
identity class with the Ready address as owner. The identity contract verifies
the owner's Ready signature. Ready's connected-wallet API cannot forward an
externally generated V3 `proofFacts` envelope, so the local Vite server submits
that outer transaction with the testnet deployer account. The submit endpoint
accepts only `apply_actions` calls to the pinned Sepolia privacy pool; the
private key never enters the browser bundle. Production must replace this local
submitter with a rate-limited AVNU SponsoredPrivate or equivalent paymaster.

Wotta generates a nonzero 200-bit viewing key in the browser. It is encrypted
with AES-GCM using a key derived from a deterministic Ready-signed SNIP-12
unlock message and stored in local storage. The viewing key is never placed in
session evidence or backend configuration. Clearing browser storage after
receiving notes loses the local key material, so this remains a smoke route,
not production key recovery.

## Wotta escrow binding

The legacy four Wotta denomination escrows remain bound to the older,
self-hosted pool and must not be used with this route. The direct SDK smoke
uses the separately deployed 1-USDC escrow below:

| Component | Sepolia value |
| --- | --- |
| Wotta direct escrow | `0x7e5b61d637f7c5c557ac4814202a7c922ebfe3233d51c9ec266a6c3c3826e8c` |
| Class hash | `0x18a1db1ba11c8f047d4e715ebe2d0d717ab11f8032966c613ef21ec2b331394` |
| Deployment transaction | `0x1a0db591c7e327dc1da08f2df16d9bf760d072f7d1723adfd17f32499bf3a04` |
| Denomination | `1_000_000` native test-USDC base units (1 USDC) |

It is constructor-bound to the compatible PriPay pool and its native test
USDC, with the router deliberately set to zero. The `Stateful private fund`
flow withdraws a private note to this escrow and invokes its `privacy_invoke`
entrypoint atomically. It creates a claim secret for the recipient and a
separate refund secret for the sender; neither secret is exported in session
evidence. Claim or refund creates a fresh open note and is proven through the
same hosted-prover path as shielding and private transfer.
