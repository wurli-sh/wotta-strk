import { getFlowUi, type FlowUi } from "./ui.ts";

export type DirectUi = {
  connect: HTMLButtonElement;
  walletAddress: HTMLElement;
  walletMeta: HTMLElement;
  identityAddress: HTMLElement;
  copyIdentity: HTMLButtonElement;
  authGoogle: HTMLButtonElement;
  authX: HTMLButtonElement;
  authUnlinkGoogle: HTMLButtonElement;
  authUnlinkX: HTMLButtonElement;
  authStatus: HTMLElement;
  recipient: HTMLInputElement;
  sourceRoute: HTMLSelectElement;
  sourceDenomination: HTMLSelectElement;
  purePrivacy: HTMLInputElement;
  claimSecret: HTMLInputElement;
  loadInbox: HTMLButtonElement;
  refundSecret: HTMLInputElement;
  generatedClaimSecret: HTMLInputElement;
  generatedRefundSecret: HTMLInputElement;
  copyGeneratedClaim: HTMLButtonElement;
  copyGeneratedRefund: HTMLButtonElement;
  exportSession: HTMLButtonElement;
  sessionSummary: HTMLElement;
  flows: {
    cctp_fund: FlowUi;
    register_identity: FlowUi;
    shield_register: FlowUi;
    balances: FlowUi;
    direct_transfer: FlowUi;
    private_fund: FlowUi;
    claim_release: FlowUi;
    private_refund: FlowUi;
  };
};

export function renderDirectApp(app: HTMLElement): DirectUi {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Phase 1A · Ready signer + direct Privacy SDK</p>
        <h1>Wotta Sepolia private payments</h1>
        <p class="lede">
          Ready approves identity ownership and submissions. Wotta holds an encrypted
          viewing key locally and uses the compatible hosted Sepolia prover and discovery service.
        </p>
      </div>
      <div class="network"><span aria-hidden="true"></span>SN_SEPOLIA</div>
    </header>
    <section class="notice" aria-label="Safety notice">
      <strong>Research-stage Sepolia route.</strong>
      <span>The viewing key is encrypted in this browser using a Ready-signed unlock message. Never clear browser state after receiving private funds.</span>
    </section>
    <section class="evm-panel">
      <div>
        <p class="label">Ready wallet</p>
        <p id="wallet-address" class="address">Not connected</p>
        <p id="wallet-meta" class="detail">Connect Ready, then approve the privacy-state unlock signature.</p>
        <p class="label">Private identity</p>
        <div class="identity-line">
          <p id="identity-address" class="address">Not deployed</p>
          <button id="copy-identity" class="secondary copy-address" type="button" disabled aria-label="Copy private identity address">Copy</button>
        </div>
      </div>
      <button id="connect-wallet" type="button">Connect Ready</button>
    </section>
    <section class="form-panel direct-input" aria-label="Private payment inputs">
      <div>
        <span class="label">Wotta handle session</span>
        <div class="identity-line"><button id="auth-google" class="secondary" type="button">Connect Google</button><button id="auth-x" class="secondary" type="button">Connect X</button><button id="auth-unlink-google" class="secondary" type="button" disabled>Unlink Google</button><button id="auth-unlink-x" class="secondary" type="button" disabled>Unlink X</button><span id="auth-status" class="detail">Not signed in</span></div>
      </div>
      <label>
        <span class="label">Recipient email, @handle, or private identity</span>
        <input id="input-recipient" type="text" spellcheck="false" placeholder="name@example.com, @handle, or 0x…" />
      </label>
      <div class="source-fields">
        <label>
          <span class="label">Circle USDC source</span>
          <select id="source-route">
            <option value="ethereum">Ethereum Sepolia</option>
            <option value="base">Base Sepolia</option>
            <option value="arbitrum">Arbitrum Sepolia</option>
            <option value="solana">Solana Devnet</option>
            <option value="stellar">Stellar Testnet</option>
          </select>
        </label>
        <label>
          <span class="label">Recipient amount</span>
          <select id="source-denomination">
            <option value="1000000">1 USDC</option>
            <option value="10000000">10 USDC</option>
            <option value="50000000">50 USDC</option>
            <option value="100000000">100 USDC</option>
          </select>
        </label>
      </div>
      <label class="identity-line"><input id="pure-privacy" type="checkbox" checked /><span><strong>Pure privacy mode</strong><br /><small>Resolve the handle to its verified private identity; private balance → private balance.</small></span></label>
      <label>
        <span class="label">Claim secret</span>
        <div class="identity-line"><input id="input-claim-secret" type="text" spellcheck="false" placeholder="0x… (for claim / release)" /><button id="load-inbox" class="secondary copy-address" type="button" disabled>Load inbox</button></div>
      </label>
      <label>
        <span class="label">Refund secret</span>
        <input id="input-refund-secret" type="text" spellcheck="false" placeholder="0x… (after expiry only)" />
      </label>
    </section>
    <section class="routes" aria-label="Direct Privacy SDK flows">
      ${card("cctp_fund", "Cross-chain · Fund recipient", "Circle CCTP V2", "burn native Circle USDC on the selected chain and deliver an encrypted private claim to the recipient handle")}
      ${card("register_identity", "1 · Register private identity", "Ready + SDK", "deploy the Ready-owned identity and register its encrypted viewing key")}
      ${card("shield_register", "2 · Shield 1 USDC", "Hosted proof", "move public Sepolia USDC into a private note")}
      ${card("balances", "3 · Private balance", "Discovery", "decrypt and sum unspent private USDC notes")}
      ${card("direct_transfer", "4 · Private transfer", "Hosted proof", "send 1 private USDC to a registered private identity")}
      ${card("private_fund", "5 · Stateful private fund", "Hosted proof", "lock 1 private USDC in Wotta until a secret claim or expiry refund")}
      ${card("claim_release", "6 · Claim / release", "Hosted proof", "release a funded Wotta payment into your private balance")}
      ${card("private_refund", "7 · Private refund", "Hosted proof", "return an expired payment to your private balance")}
    </section>
    <section class="form-panel direct-input secret-output" aria-label="New private payment recovery package">
      <p class="detail"><strong>New payment package.</strong> After funding, share the claim secret privately with the recipient and retain the refund secret. Neither secret is put in session evidence.</p>
      <label>
        <span class="label">New claim secret</span>
        <div class="identity-line"><input id="generated-claim-secret" type="text" readonly placeholder="Created after funding" /><button id="copy-generated-claim" class="secondary copy-address" type="button" disabled>Copy</button></div>
      </label>
      <label>
        <span class="label">New refund secret</span>
        <div class="identity-line"><input id="generated-refund-secret" type="text" readonly placeholder="Created after funding" /><button id="copy-generated-refund" class="secondary copy-address" type="button" disabled>Copy</button></div>
      </label>
    </section>
    <section class="session-panel">
      <div><p class="label">Session evidence</p><p id="session-summary" class="detail">No events yet.</p></div>
      <button id="export-session" class="secondary" type="button">Export session JSON</button>
    </section>
    <footer>Recipient values are private identity addresses, not ordinary Ready account addresses.</footer>
  `;
  return {
    connect: required("#connect-wallet"),
    walletAddress: required("#wallet-address"),
    walletMeta: required("#wallet-meta"),
    identityAddress: required("#identity-address"),
    copyIdentity: required("#copy-identity"),
    authGoogle: required("#auth-google"),
    authX: required("#auth-x"),
    authUnlinkGoogle: required("#auth-unlink-google"),
    authUnlinkX: required("#auth-unlink-x"),
    authStatus: required("#auth-status"),
    recipient: required("#input-recipient"),
    sourceRoute: required("#source-route"),
    sourceDenomination: required("#source-denomination"),
    purePrivacy: required("#pure-privacy"),
    claimSecret: required("#input-claim-secret"),
    loadInbox: required("#load-inbox"),
    refundSecret: required("#input-refund-secret"),
    generatedClaimSecret: required("#generated-claim-secret"),
    generatedRefundSecret: required("#generated-refund-secret"),
    copyGeneratedClaim: required("#copy-generated-claim"),
    copyGeneratedRefund: required("#copy-generated-refund"),
    exportSession: required("#export-session"),
    sessionSummary: required("#session-summary"),
    flows: {
      cctp_fund: getFlowUi("cctp_fund"),
      register_identity: getFlowUi("register_identity"),
      shield_register: getFlowUi("shield_register"),
      balances: getFlowUi("balances"),
      direct_transfer: getFlowUi("direct_transfer"),
      private_fund: getFlowUi("private_fund"),
      claim_release: getFlowUi("claim_release"),
      private_refund: getFlowUi("private_refund"),
    },
  };
}

function card(id: string, title: string, badge: string, note: string): string {
  return `
    <article class="route-card" id="${id}-card">
      <p class="eyebrow">${badge}</p><h2>${title}</h2>
      <p class="route-note">${note}</p>
      <p id="${id}-detail" class="detail">Connect Ready before running this flow.</p>
      <div class="actions"><button id="${id}-run" type="button" disabled>Run</button></div>
      <div id="${id}-status" class="status" data-tone="idle" aria-live="polite"><span aria-hidden="true"></span><p>Idle</p></div>
    </article>`;
}

function required<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`${selector} missing`);
  return value;
}
