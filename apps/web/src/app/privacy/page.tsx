"use client";

import { PageShell } from "@/components/PageShell";
import { useNetworkMode } from "@/components/NetworkModeProvider";

function PrivacyContent() {
  const { mode } = useNetworkMode();
  return (
    <PageShell
      title="Privacy"
      subtitle="What stays private — and what doesn’t."
      maxWidth="md"
    >
      <div className="space-y-8" data-testid="privacy-page">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {mode === "mainnet"
            ? "Mainnet mode uses real funds and only Ready’s wallet-managed live STRK20 pool. It supports allowlisted USDC shield amounts, registered-recipient private transfer, and public withdrawal. The system is unaudited; use only the minimum demo funds."
            : "Testnet beta uses public source testnets, Starknet Sepolia contracts, the Starknet privacy SDK, and a hosted prover. The system is unaudited and is not suitable for meaningful funds."}
        </p>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Private in the product path
          </h2>
          <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              Inbox note payloads and one-time claim material are encrypted to
              the recipient’s locally unlocked inbox key.
            </li>
            <li>
              Private pool actions are authorized with generated proofs rather
              than exposing the private note material to the web API.
            </li>
            <li>
              Inbox and privacy secrets are encrypted locally. Wotta does not
              store raw keys, decrypted inbox contents, or proof secrets in its
              database.
            </li>
            <li>
              A cross-chain note becomes claimable only after the canonical
              indexer observes its funded Starknet escrow state.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Public by design
          </h2>
          <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>
              Linked Starknet addresses, source-chain approvals and burns,
              CCTP messages, settlement transactions, token amounts, and
              timing are public on their respective networks.
            </li>
            <li>
              Proof submission and pool state changes are public Starknet
              transactions even when private note material is not disclosed.
            </li>
            <li>
              Handle or verified-email availability is public yes/no metadata.
              Recipient resolution is an authenticated API request. Encrypted
              delivery stores ciphertext and routing metadata, while OAuth
              identifiers remain subject to the identity service’s data model.
            </li>
            <li>
              {mode === "mainnet"
                ? "Mainnet actions are limited to 0.5, 1, 10, 50, or 100 native USDC; the qualification demo uses 0.5 USDC."
                : "Testnet settlement denominations are exact whole USDC amounts: 1, 10, 50, or 100."}
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            What we will not claim
          </h2>
          <ul className="mt-3 list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>Not an anonymous bridge.</li>
            <li>Not untraceable or fully private end-to-end.</li>
            <li>
              Not an invisible wallet: the linked Starknet address and public
              wallet activity remain visible.
            </li>
            <li>
              Not guaranteed anonymity; privacy depends on shared denominations
              and real pool activity.
            </li>
            <li>Multi-step wallet approvals are not “one click.”</li>
            <li>
              Status is not “Escrowed” until the indexer reports the Starknet
              escrow as funded, and not “Claimed” until it observes the claim.
            </li>
            <li>
              {mode === "mainnet"
                ? "Not audited production infrastructure: Mainnet remains limited to Ready’s direct Starknet private route and allowlisted amounts."
                : "Not a production deployment: contracts, relayers, adapters, and the hosted prover require independent audit and retained live test evidence before broader mainnet use."}
            </li>
          </ul>
        </section>
      </div>
    </PageShell>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
