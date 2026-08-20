# STRK20 Private Sprint

**Official page:** [strk20.starknet.io/hackathon](https://strk20.starknet.io/hackathon)
**Apply repo:** [github.com/starkience/strk20-hackathon](https://github.com/starkience/strk20-hackathon)

An 18-day online sprint to ship a **real privacy application on Starknet mainnet** using [STRK20](https://strk20.starknet.io/) — StarkWare's privacy layer for ERC-20 assets (shielded balances, private transfers, private DeFi against existing liquidity).

Everyone builds in the open on their own public GitHub repo. Every push shows up on the hub while the sprint is running. Hub data refreshes every **30 minutes**.

---

## Snapshot

| | |
|---|---|
| **Name** | Private Sprint — Build privacy apps on Starknet |
| **Host** | STRK20 / StarkWare (Starknet ecosystem) |
| **Mode** | Online, build-in-public |
| **Duration** | 18 days |
| **Chain** | Starknet **mainnet only** (to win) |
| **Prize pool** | **$5,000 USD paid in STRK** |
| **Status (as of 17 Aug 2026)** | Live — registration and hacking open |

---

## Timeline

| Date | What |
|---|---|
| **14 August 2026** | Registration and hacking open |
| **31 August 2026, 23:59 UTC** | Submissions close. Whatever your repo shows at this timestamp is your entry. |
| **4 September 2026** | Winners announced |

Registration stays open for the whole sprint. Merging your apply PR only decides when you appear on the hub — you can start building before it merges.

---

## Prize pool

**$5,000 USD paid in STRK.** One payout address per winning team.

| Place | Amount |
|---|---|
| 1st | **$2,500** |
| 2nd | **$1,500** |
| 3rd | **$1,000** |

### After the sprint

Strong projects may get continued support:

- Technical feedback from the StarkWare privacy team
- Ecosystem introductions
- A path into the [Starknet Foundation Grants Program](https://www.starknet.io/)
- Related longer-term track: [Proof of Privacy Incubator](https://proof.starknet.io) (8 weeks of mentorship, milestone support, demo day)

---

## How it works

There is **no traditional “submit” button**. One apply PR, then everything else is read from your public repo.

### 1. Apply (the only PR you ever open)

Fork [starkience/strk20-hackathon](https://github.com/starkience/strk20-hackathon) and append **one object** to `registry.json`. Do not edit anyone else's entry.

Minimum valid entry:

```json
{
  "repo_url": "https://github.com/your-org/your-repo",
  "telegram": ["your_telegram", "teammate_telegram"]
}
```

| Field | Required | Notes |
|---|---|---|
| `repo_url` | yes | Public GitHub repo. Needs at least one commit before it appears on the hub. |
| `telegram` | yes | Usernames only — no `@`, no `t.me` links. One per teammate. How STRK20 reaches you. |

Optional (only if auto-derived values are wrong):

| Field | Default | Notes |
|---|---|---|
| `name` | repo name | |
| `one_liner` | GitHub repo description | |
| `slug` | repo name, lowercased/hyphenated | Must be unique |
| `category` | `Other` | `Consumer`, `DeFi`, `Tooling`, `Infra`, `Payments`, `Gaming`, `Other` |
| `team` | commit history | GitHub usernames if detection misses someone |
| `x_handle` | — | Without `@` |
| `inspired_by` | — | An ID from `IDEAS.md` (e.g. `RFP-11`, `IDEA-12`) |

**Apply PR mechanics:**

- Valid PRs auto-merge (usually within a minute). Project appears on the hub within ~30 minutes.
- Ignore merge conflicts. Everyone appends to the same array; a bot rewrites your branch. Leave **Allow edits by maintainers** on.
- A PR that changes an existing row waits for a maintainer.
- Nothing needs to be deployed to apply.

### 2. Build in public

Work in **your own public repository**. The hub reads:

- Latest push and how long ago
- A sentence describing what changed
- Lines added / removed
- What the project does (from README)
- Stack (`package.json`, `Scarb.toml`, README)
- Deployed contracts and which network each is on
- Live demo (see demo discovery below)
- Team avatars (from commit history)

You never open a PR to report progress.

### 3. Ship to mainnet

To win, the app must run on **Starknet mainnet against the live STRK20 pool**:

- At least **three successful mainnet transactions** that touched the pool
- A demo anyone can open (no login wall)
- Add your Starknet address / hashes once you have them

### 4. Nothing to submit

Whatever your repository shows at **31 August 2026, 23:59 UTC** is the entry.

Judges need **four pieces** (hub shows which are still missing):

1. Live demo
2. Contract addresses (if you deployed any)
3. Starknet / tx evidence (`transactions` in `strk20.json`)
4. Demo video

---

## `strk20.json` (in *your* repo, not the apply PR)

Put this at the **root of your own repository**. Add fields as you have them. The panel reads this file when scoring.

```json
{
  "transactions": ["0x07c0...", "0x04b2...", "0x0919..."],
  "contracts": ["0x0abc...", "0x0def..."],
  "demo_video": "https://youtu.be/...",
  "demo_url": "https://your-demo.example"
}
```

| Field | Needed to be scored? | Notes |
|---|---|---|
| `transactions` | **yes** | ≥3 mainnet tx hashes. Each must exist, succeed, and have touched the STRK20 pool. If you listed `contracts`, the tx must also carry an event from one of yours — touching the pool through someone else's contract is not “your project on mainnet.” Projects that deploy nothing of their own are judged on the pool alone. Hashes (not an address) because private txs are relayed; the on-chain sender is never you. |
| `contracts` | no | Deployed addresses. Checked against mainnet and Sepolia; shown with the network found. |
| `demo_video` | **yes** | ~3-minute demo video. |
| `demo_url` | no | Only if auto-discovery fails. |

### Demo discovery order

1. `demo_url` in `strk20.json` (explicit always wins)
2. GitHub Pages
3. Repo **Website** field (About box) — most reliable one-click option
4. Latest successful GitHub-reported deployment

A project with none of these still appears on the hub — it just **cannot be scored**.

---

## Eligibility and rules

- Anyone can apply: individuals and teams. Applications are reviewed (via the registry PR checks).
- Existing or new projects are both allowed.
- Repo must be **public and open-source**, with a **license**.
- Starknet **mainnet** deployment / pool interaction required to win.
- Public demo URL anyone can open without being logged in.
- One payout address per winning team.
- Ideas are **not exclusive** — several teams can build the same idea.
- **No secrets** in the repo. Placeholder values for keys, addresses, endpoints.
- Be precise about what is and isn't private. Overclaiming costs integration-depth points.

---

## Judging

A named panel scores every submitted project **after** submissions close. The hub does **not** rank by merit.

| Weight | Criterion |
|---|---|
| **30%** | **STRK20 integration depth** — how far into the stack you went: shielded balances, private transfers, anonymizer contracts, the SDK, stealth / sub-accounts |
| **30%** | **Working mainnet product** — it runs on mainnet for a real user. Not a prototype behind a login. |
| **25%** | **Innovation** — something the ecosystem doesn't have yet, or a materially better take on something it does |
| **15%** | **Documentation & open-source quality** — a README someone can follow, code someone can build on, a license |

If another team depends on something you published, that counts in your favour.

### README judges actually read

Cover:

- What it does and **why it needed privacy**
- How to run it locally
- Mainnet contract addresses
- What is public vs private (see privacy model below)

---

## What STRK20 is (the stack you must integrate)

STRK20 is Starknet's privacy capability: any supported ERC-20 can exist privately through **shielding**. Built by StarkWare. Private by default, disclosable when required (per-user viewing keys + on-chain deposit screening).

### Core pieces

| Piece | Role |
|---|---|
| **STRK20 pool** | Live mainnet pool. Holds ERC-20s as encrypted notes (UTXOs). Enables shielded balances, private transfers, private DeFi. Not a mixer. |
| **Starknet Wallet API** | App-layer route **most dapps should use**. Via `starknet.js`, ask the user's privacy-enabled wallet to shield / transfer / unshield / swap. Dapp never touches viewing keys or the SDK. Ready (extension) + starknet.js is the current start path; Xverse Wallet API rolling out. |
| **Anonymizer contracts** | App-specific `privacy_invoke` adapters. Pool withdraws → your contract does the thing (swap, lend, escrow) → result credited back as private notes, **atomically**. Any revert rolls the whole tx back. |
| **Privacy SDK** | Low-level TypeScript client (Apache 2.0) for wallets / advanced integrators: viewing keys, channels, note discovery, proving. |
| **Prover backend** | Self-host via open-source Prover Crate if you need control. Hosted proving also exists. |
| **Private sub-accounts** | Hide the public link between a main wallet and app activity. **Coming soon — not fully live.** |

### Integration routes (pick one)

1. **Private dapp** — anonymizer contracts + Wallet API (DeFi, consumer, games)
2. **Privacy wallet / advanced backend** — Privacy SDK
3. **Run your own prover** — operate proof generation yourself
4. **Hide the wallet link** — private sub-accounts (not shipped yet)

### Why this stack exists (product claims)

- Protocol-level privacy, one unified pool → anonymity set grows with usage
- Anonymous DeFi on **existing** AMM liquidity (Ekubo, AVNU) — no unshield-swap-reshield
- Multi-call composability: unshield, swap, flash-loan, repay, reshield in one private tx
- No new wallet: existing Starknet wallets via native account abstraction
- Compliance-first: FPI screens depositing addresses and signs every deposit; the pool verifies that signature on-chain. Running your own prover does **not** bypass this.
- Built on Cairo for both contracts and proving

### What is and isn't private

Be exact in the README. Overclaiming is the fastest way to lose integration-depth points.

| Public | Private |
|---|---|
| Deposits: address, token, amount | Note-to-note transfers: amounts and parties |
| Withdrawal destination and amount | Which deposit a withdrawal came from |
| Swap and lending amounts, and their timing | **Who** performed the swap or loan |

Private DeFi routes through shared anonymizer contracts into **public** venues. A distinctive amount soon after a distinctive deposit is correlatable. Claim **identity** privacy for swaps; do not claim amount privacy for swaps.

Shielding itself is not private — *what you do afterwards* is.

---

## Mainnet constants (from Day 0 guide)

Sprint is **mainnet-only** for prizes. Three txs of a few STRK each satisfy eligibility — start with amounts you would not mind losing.

| | |
|---|---|
| Chain | `SN_MAIN` (`0x534e5f4d41494e`) |
| RPC | `https://rpc.starknet.lava.build` |
| **Pool** | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Pool on Voyager | [voyager.online/contract/0x0403…812a](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |

Wallets called out for Day 0: **Ready** (formerly Argent) or **Braavos**, switched to Mainnet.

**Day 0 path (before writing product code):**

1. Register viewing key (once, on-chain) — or do it in the UI at [strk20.starknet.io/app](https://strk20.starknet.io/app)
2. Shield (deposit) — public; compliance-screened
3. Do something private (note-to-note transfer)
4. Confirm pool interactions on Voyager; paste hashes into `strk20.json`

Private txs are submitted by **rotating shared relayers**. The sender on-chain is a relayer, not you. That is expected. Eligibility is verified against pool events (`Deposit` / pool events), not the tx sender.

Full walkthrough: [docs/MAINNET-DAY-0.md](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md)

---

## Ideas (inspiration, not bounties)

Full list: [IDEAS.md](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md)
Long-form RFPs: [strk20.starknet.io/rfp](https://strk20.starknet.io/rfp)

Build one of these, a variation, or something else entirely. Several teams can take the same idea.

> **Warning:** some ideas depend on **sub-accounts** or **confidential compute**, which are **not shipped yet**. If that is central to the idea, ask in the Telegram group before starting.

### Request for Startups (full write-ups)

| ID | Idea | Category |
|---|---|---|
| RFP-01 | [Encrypted on-chain messaging](https://strk20.starknet.io/rfp/private-messaging) | Social |
| RFP-02 | [Anonymous whistleblower platform with proof-of-authorship](https://strk20.starknet.io/rfp/anonymous-whistleblower) | Social |
| RFP-03 | [Provably fair poker](https://strk20.starknet.io/rfp/private-poker) | Gaming |
| RFP-04 | [On-chain Among Us / social deduction](https://strk20.starknet.io/rfp/social-deduction-game) | Gaming |
| RFP-05 | [Trustless atomic OTC settlement](https://strk20.starknet.io/rfp/private-otc-settlement) | Markets |
| RFP-06 | [Bonding-curve launches (private pump.fun)](https://strk20.starknet.io/rfp/private-pumpfun) | Markets |
| RFP-07 | [Prediction markets — visible odds, invisible bettors](https://strk20.starknet.io/rfp/private-prediction-market) | Markets |
| RFP-08 | [Sealed-bid auctions](https://strk20.starknet.io/rfp/sealed-bid-auctions) | Markets |
| RFP-09 | [One-click privacy from any chain](https://strk20.starknet.io/rfp/cross-chain-privacy-hub) | Infrastructure |
| RFP-10 | [Umbra-style privacy wallet for Starknet](https://strk20.starknet.io/rfp/privacy-wallet) | Infrastructure |
| RFP-11 | [Private payroll and treasury disbursement](https://strk20.starknet.io/rfp/private-payroll) | Payments |
| RFP-12 | [Private subscriptions / creator monetization](https://strk20.starknet.io/rfp/private-subscriptions) | Payments |

Additional RFP pages also live under `/rfp/` (e.g. private neobank, DAO treasury OS, yield account, compliance layer). Shorter sprint prompts:

### Trading and markets

| ID | Idea | Blocked on |
|---|---|---|
| IDEA-01 | Private spot execution across chains | |
| IDEA-02 | Private perpetuals aggregation | |
| IDEA-03 | Private prediction-market execution | |
| IDEA-04 | Hidden and conditional orders | confidential compute |
| IDEA-05 | Private accumulation and exit | sub-accounts |
| IDEA-06 | Private intent network | confidential compute |
| IDEA-07 | Confidential RFQ for block trades | |
| IDEA-08 | Professional trading terminal | |

### Payments

| ID | Idea |
|---|---|
| IDEA-09 | Payments by identifier (phone, email, QR), not address |
| IDEA-10 | Business payouts API |
| IDEA-11 | Merchant checkout and invoicing |
| IDEA-12 | Marketplace escrow |
| IDEA-13 | Private account and card |

### Wealth / capital / infra / governance

| ID | Idea | Blocked on |
|---|---|---|
| IDEA-14 | Private market-maker vaults | |
| IDEA-15 | Private index and copy-trading vaults | |
| IDEA-16 | Private yield account | |
| IDEA-17 | Confidential token launch platform | |
| IDEA-18 | Multi-wallet launch participation | sub-accounts |
| IDEA-19 | Private cross-chain bridge | |
| IDEA-20 | Private account and portfolio layer | sub-accounts |
| IDEA-21 | Selective disclosure tooling | |
| IDEA-22 | Compliance infrastructure for privacy apps | |
| IDEA-23 | Open note indexer | |
| IDEA-24 | Local development environment | |
| IDEA-25 | Transaction privacy simulator | |
| IDEA-26 | Drop-in component kit (other teams depending on you helps your score) | |
| IDEA-27 | Private governance and delegation | |
| IDEA-28 | Private treasury operations | |

---

## Builder resources

| Resource | URL | What it is |
|---|---|---|
| Starter kit (hackathon page) | [starkware-libs/starknet-privacy-starter-kit](https://github.com/starkware-libs/starknet-privacy-starter-kit) | Clone-and-go template with a working escrow demo wired to the live pool |
| Starter kit (README / build page) | [Akashneelesh/strk20-starter-kit](https://github.com/Akashneelesh/strk20-starter-kit) | Lean Next.js app: wallet picker, shield / unshield / private transfer, shielded balances, deployable `privacy_invoke` helper |
| STRK20 by Example | [strk20-by-example.org](https://strk20-by-example.org/what-is-strk20) | Pool, Wallet API, anonymizer contracts, SDK. Agent dump: [llms-full.txt](https://strk20-by-example.org/llms-full.txt) |
| Privacy SDK | [starkware-libs/starknet-privacy](https://github.com/starkware-libs/starknet-privacy) | Apache-2.0 monorepo: TypeScript SDK, pool contracts, anonymizer packages, proving |
| Awesome STRK20 | [Akashneelesh/awesome-strk20](https://github.com/Akashneelesh/awesome-strk20) | Libraries, resources, PoCs |
| Build page | [strk20.starknet.io/build](https://strk20.starknet.io/build) | Integration routes |
| Day 0 guide | [MAINNET-DAY-0.md](https://github.com/starkience/strk20-hackathon/blob/main/docs/MAINNET-DAY-0.md) | Zero → shielded mainnet balance |
| Brand / UI kit | [strk20.starknet.io/brand](https://strk20.starknet.io/brand) | Tokens + guidelines |
| Live apps | [strk20.starknet.io/app/live-apps](https://strk20.starknet.io/app/live-apps) | Wallets, bridges, private DeFi already live |
| Product explainer | [Push to Private (Starknet blog)](https://www.starknet.io/blog/push-to-private/) | SDK + Wallet API announcement |
| Agent index | [strk20.starknet.io/llms-full.txt](https://strk20.starknet.io/llms-full.txt) | Full site dump |

### Ecosystem already building on STRK20 (context, not competitors to copy blindly)

AVNU (private swaps live), Troves, ForgeYields, Provable Games, DeFa Invoicemate, Ready, Xverse, Endur, Polyhedge, Ekubo, plus DashX, ArcX, Privily, Zylith, Vesu, Opus, Cartridge exploring the stack.

---

## Support during the sprint

- **Telegram group** — STRK20 team is in it every day for architecture, integration, and infra blockers. Your Telegram usernames in `registry.json` are how they reach you.
- **GitHub issues** on [starkience/strk20-hackathon](https://github.com/starkience/strk20-hackathon/issues) — team reads them every day.
- **Book a call** (idea validation): [cal.com/adithyadinesh](https://cal.com/adithyadinesh)

---

## Winning checklist

Use this against the hub's missing-items row before 31 Aug 23:59 UTC.

- [ ] Apply PR merged (`registry.json` entry with `repo_url` + Telegram)
- [ ] Public repo, license, README (what / why privacy / how to run / contracts)
- [ ] Building in public; hub picking up pushes
- [ ] Viewing key registered on mainnet
- [ ] App uses live STRK20 pool (not only Sepolia)
- [ ] ≥3 successful mainnet txs that touched the pool, hashes in `strk20.json`
- [ ] If you deployed contracts: those addresses in `strk20.json`, and txs actually go through *your* contracts
- [ ] Live demo anyone can open (Pages / Website field / `demo_url`)
- [ ] ~3-minute demo video URL in `strk20.json`
- [ ] Honest public-vs-private claims
- [ ] No secrets in git

---

## Source links

- [Hackathon hub](https://strk20.starknet.io/hackathon)
- [Hackathon markdown mirror](https://strk20.starknet.io/hackathon.md)
- [Apply + rules repo](https://github.com/starkience/strk20-hackathon)
- [CONTRIBUTING.md](https://github.com/starkience/strk20-hackathon/blob/main/CONTRIBUTING.md)
- [IDEAS.md](https://github.com/starkience/strk20-hackathon/blob/main/IDEAS.md)
- [STRK20 home](https://strk20.starknet.io/)
- [Request for Startups](https://strk20.starknet.io/rfp)
