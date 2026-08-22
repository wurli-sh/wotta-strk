export type Tone = "idle" | "loading" | "error" | "success";

export type FlowUi = {
  id: string;
  run: HTMLButtonElement;
  detail: HTMLElement;
  status: HTMLElement;
};

export function renderApp(app: HTMLElement, chainId: "SN_MAIN" | "SN_SEPOLIA"): void {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Phase 1A · Ready / Wallet API</p>
        <h1>Wotta STRK20 wallet-smoke</h1>
        <p class="lede">
          Ready-managed shield/registration, private balances, and direct transfer.
          Escrow-private actions stay gated until Ready's pool binding is verified.
          Risky actions always run <code>strk20PrepareInvoke(actions, true)</code>
          first and fail closed when Ready cannot support Wallet API 0.10.3.
        </p>
      </div>
      <div class="network"><span aria-hidden="true"></span>${chainId}</div>
    </header>
    <section class="notice" aria-label="Safety notice">
      <strong>Keys stay in Ready.</strong>
      <span>
        Proof generation can take a long time. Leave this tab open. Never paste a
        viewing key or recovery phrase here. On Sepolia, fund the connected account
        with <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle test USDC</a>
        before shielding.
      </span>
    </section>
    <section class="evm-panel">
      <div>
        <p class="label">Ready wallet</p>
        <p id="wallet-address" class="address">Not connected</p>
        <p id="wallet-meta" class="detail">Connect Ready to feature-detect STRK20 methods.</p>
      </div>
      <button id="connect-wallet" type="button">Connect Ready</button>
    </section>
    <section class="form-panel" aria-label="Spike inputs">
      <label>
        <span class="label">Transfer / claim recipient</span>
        <input id="input-recipient" type="text" spellcheck="false" placeholder="0x…" />
      </label>
      <label>
        <span class="label">Fund commitment hash</span>
        <input id="input-commitment" type="text" spellcheck="false" placeholder="0x…" />
      </label>
      <label>
        <span class="label">Claim secret (never logged)</span>
        <input id="input-secret" type="password" spellcheck="false" placeholder="0x…" />
      </label>
    </section>
    <section class="routes" aria-label="STRK20 flows">
      ${flowCard("shield_register", "1 · Shield / register", "Ready-managed", "deposit 1 public Ready-route USDC into the supported STRK20 pool")}
      ${flowCard("balances", "2 · Private balances", "Safe read", "strk20Balances([USDC])")}
      ${flowCard("direct_transfer", "3 · Direct private transfer", "Simulate → invoke", "transfer to a registered recipient")}
      ${flowCard("private_fund", "4 · Stateful private fund", "Gated", "requires a Ready-pool-matched Wotta escrow")}
      ${flowCard("claim_release", "5 · Claim / release", "Gated", "requires corrected escrow action encoding")}
    </section>
    <section class="session-panel">
      <div>
        <p class="label">Session evidence</p>
        <p id="session-summary" class="detail">No events yet.</p>
      </div>
      <div class="actions">
        <button id="export-session" class="secondary" type="button">Export smoke-session JSON</button>
      </div>
    </section>
    <footer>
      Export the session JSON, then run
      <code>pnpm evidence:wallet-api -- path/to/session.json</code>
      to materialize <code>evidence/&lt;manifest-hash&gt;/phase1-wallet-api/</code>.
    </footer>
  `;
}

function flowCard(
  id: string,
  title: string,
  badge: string,
  note: string,
): string {
  return `
    <article class="route-card" id="${id}-card">
      <div class="route-heading">
        <div>
          <p class="eyebrow">${badge}</p>
          <h2>${title}</h2>
        </div>
      </div>
      <p class="route-note">${note}</p>
      <p id="${id}-detail" class="detail">Connect Ready before running this flow.</p>
      <div class="actions">
        <button id="${id}-run" type="button" disabled>Run</button>
      </div>
      <div id="${id}-status" class="status" data-tone="idle" aria-live="polite">
        <span aria-hidden="true"></span><p>Idle</p>
      </div>
    </article>
  `;
}

export function getFlowUi(id: string): FlowUi {
  const element = <T extends HTMLElement>(suffix: string) => {
    const found = document.querySelector<T>(`#${id}-${suffix}`);
    if (!found) throw new Error(`${id}-${suffix} missing`);
    return found;
  };
  return {
    id,
    run: element<HTMLButtonElement>("run"),
    detail: element("detail"),
    status: element("status"),
  };
}

export function truncate(value: string): string {
  return value.length <= 13
    ? value
    : `${value.slice(0, 6)}…${value.slice(-5)}`;
}

export function setStatus(
  ui: FlowUi,
  tone: Tone,
  message: string,
): void {
  ui.status.dataset.tone = tone;
  const text = ui.status.querySelector("p");
  if (text) text.textContent = message;
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}
