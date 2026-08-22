import { createClient as createSupabaseJsClient, type SupabaseClient, type UserIdentity } from "@supabase/supabase-js";
import { createClient as createAppSupabaseClient } from "../supabase/client";
import {
  connectEvmSource,
  connectSolanaSource,
  connectStellarSource,
  executeEvmCctpBurn,
  executeSolanaCctpBurn,
  executeStellarCctpBurn,
  type EvmCctpBurnPlan,
  type NonEvmCctpBurnPlan,
  type WottaSourceRoute,
} from "@wotta/adapters";
import { decryptEnvelope, encryptEnvelope, generateInboxKeyPair, publicKeyFromSecret } from "@wotta/crypto";
import { computeClaimHash, type Denomination } from "@wotta/shared";
import { stark, type TypedData, type WalletAccountV6 } from "starknet";
import { oauthCallbackUrl, stashAuthNext } from "../app-origin.ts";
import {
  cleanOAuthCallbackUrl,
  describeOAuthCallbackFailure,
  normalizeIdentityLinkError,
  parseOAuthCallbackFailure,
  type AuthProvider,
} from "./auth-errors.ts";
export type ProductApiConfig = {
  apiUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  solanaRpcUrl: string;
  stellarRpcUrl: string;
};

export type PrivacyVault = {
  state: { inboxSecretKey?: string };
  setInboxSecretKey(inboxSecretKey: string): Promise<void>;
};

export type ProductSession = WottaProductSession;

const pendingProviderKey = "wotta:pending-oauth-provider";

export function consumeOAuthCallbackFailure(): Error | undefined {
  const failure = parseOAuthCallbackFailure(window.location.href);
  if (!failure) return undefined;
  const pending = window.sessionStorage.getItem(pendingProviderKey);
  const provider = pending === "google" || pending === "x" ? pending : undefined;
  window.sessionStorage.removeItem(pendingProviderKey);
  window.history.replaceState(window.history.state, "", cleanOAuthCallbackUrl(window.location.href));
  return describeOAuthCallbackFailure(failure, provider);
}

export function createProductSession(config: ProductApiConfig): ProductSession {
  const supabase = createSupabaseJsClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return new WottaProductSession(supabase, config);
}

let browserProductSession: ProductSession | undefined;

/** Browser product session — shares the app Supabase client (cookie session), not a separate localStorage client. */
export function createBrowserProductSession(): ProductSession {
  if (typeof window === "undefined") {
    throw new Error("createBrowserProductSession is browser-only");
  }
  if (browserProductSession) return browserProductSession;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase browser configuration is missing");
  }

  browserProductSession = new WottaProductSession(createAppSupabaseClient(), {
    apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    supabaseUrl,
    supabasePublishableKey,
    solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    stellarRpcUrl: process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
  });
  return browserProductSession;
}

export type FundingStage = "resolving" | "quoting" | "delivering" | "connecting_source" | "approving" | "burning" | "confirming" | "settling";
export type RouteManifest = {
  routes: Array<{ id: string; enabled: boolean; reason?: string }>;
  manifestHash: string;
  pendingDeliveryPublicKey: string;
  router?: string;
  escrows: Array<{ denomination: Denomination; address: string; classHash: string }>;
  privacyPool?: string;
};
type RecipientDescriptor = {
  registered: boolean;
  inboxEncryptionPublicKey?: string;
};
type SignedQuote = {
  quote: { sourcePlan: EvmCctpBurnPlan | NonEvmCctpBurnPlan };
  signature: string;
};
type ClaimEnvelope = {
  v: 1;
  intentId: string;
  claimSecret: string;
  escrow: string;
  denomination: Denomination;
  expiresAt: string;
  chainId: "SN_SEPOLIA";
};

export class WottaProductSession {
  constructor(private readonly supabase: SupabaseClient, private readonly config: ProductApiConfig) {}

  private authReturnPath() {
    return `${window.location.pathname}${window.location.search}`;
  }

  async connectProvider(provider: AuthProvider) {
    const supabaseProvider = provider === "x" ? "twitter" : provider;
    const { data: { session } } = await this.supabase.auth.getSession();
    const alreadyLinked = session?.user.identities?.some((identity) =>
      provider === "x" ? identity.provider === "x" || identity.provider === "twitter" : identity.provider === provider);
    if (alreadyLinked) {
      await this.syncSession();
      return { mode: "already_linked" as const };
    }
    const callback = oauthCallbackUrl();
    stashAuthNext(this.authReturnPath());
    if (session) {
      window.sessionStorage.setItem(pendingProviderKey, provider);
      const { error } = await this.supabase.auth.linkIdentity({
        provider: supabaseProvider,
        options: { redirectTo: callback },
      });
      if (error) {
        window.sessionStorage.removeItem(pendingProviderKey);
        throw normalizeIdentityLinkError(error, provider);
      }
      return { mode: "link" as const };
    }
    window.sessionStorage.setItem(pendingProviderKey, provider);
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: supabaseProvider,
      options: { redirectTo: callback },
    });
    if (error) {
      window.sessionStorage.removeItem(pendingProviderKey);
      throw error;
    }
    return { mode: "sign_in" as const };
  }

  async unlinkProvider(provider: "google" | "x") {
    const { data: { user }, error: userError } = await this.supabase.auth.getUser();
    if (userError || !user) throw userError ?? new Error("Sign in first");
    const identities = user.identities ?? [];
    if (identities.length <= 1) throw new Error("Keep at least one sign-in provider linked");
    const identity = identities.find((candidate) =>
      provider === "x" ? candidate.provider === "x" || candidate.provider === "twitter" : candidate.provider === provider) as UserIdentity | undefined;
    if (!identity) throw new Error(`${provider === "x" ? "X" : "Google"} is not linked`);
    const { error } = await this.supabase.auth.unlinkIdentity(identity);
    if (error) throw error;
    await this.supabase.auth.refreshSession();
    await this.syncSession();
  }

  async authState(): Promise<{ label?: string; providers: Array<"google" | "x"> }> {
    const { data } = await this.supabase.auth.getSession();
    const user = data.session?.user;
    const providers = new Set<"google" | "x">();
    for (const identity of user?.identities ?? []) {
      if (identity.provider === "google") providers.add("google");
      if (identity.provider === "x" || identity.provider === "twitter") providers.add("x");
    }
    return {
      label: user?.email ?? user?.user_metadata.user_name,
      providers: [...providers],
    };
  }

  async syncSession() {
    return this.request<{ profileId: string; synced: Array<{ provider: "email" | "google" | "x"; identifier: string }>; revoked: number }>("/v1/session/sync", { method: "POST" });
  }

  async me() {
    return this.request<{
      profile: { id: string } | null;
      identities: Array<{ provider: "email" | "google" | "x"; normalized_identifier: string }>;
      wallet: {
        address: string;
        inbox_pubkey: string;
        private_identity_address?: string | null;
        privacy_pool_address?: string | null;
      } | null;
    }>("/v1/me");
  }

  async routeManifest() {
    return this.request<RouteManifest>("/v1/routes");
  }

  async resolveRecipient(input: { provider: "email" | "x"; identifier: string }) {
    return this.request<{ descriptor: RecipientDescriptor }>("/v1/resolve", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async signIn(provider: "google" | "x") {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await this.supabase.auth.signInWithOAuth({ provider: provider === "x" ? "twitter" : provider, options: { redirectTo } });
    if (error) throw error;
  }

  async userLabel(): Promise<string | undefined> {
    return (await this.authState()).label;
  }

  async bindReadyAndIdentity(account: WalletAccountV6, vault: PrivacyVault, identityAddress?: string) {
    await this.syncSession();
    const me = await this.request<{ wallet: { address: string; inbox_pubkey: string } | null }>("/v1/me");
    let inboxSecretKey = vault.state.inboxSecretKey;
    if (!me.wallet) {
      if (!inboxSecretKey) {
        inboxSecretKey = generateInboxKeyPair().secretKey;
        await vault.setInboxSecretKey(inboxSecretKey);
      }
      const inboxPublicKey = publicKeyFromSecret(inboxSecretKey);
      const challenge = await this.request<{ typedData: TypedData }>("/v1/wallet/challenge", { method: "POST", body: JSON.stringify({ address: account.address }) });
      const signature = stark.formatSignature(await account.signMessage(challenge.typedData));
      await this.request("/v1/wallet/link", { method: "POST", body: JSON.stringify({ challenge: JSON.stringify(challenge.typedData), signature, inboxPublicKey }) });
    } else {
      if (BigInt(me.wallet.address) !== BigInt(account.address)) throw new Error("This handle is linked to a different Ready account");
      if (!inboxSecretKey || publicKeyFromSecret(inboxSecretKey) !== me.wallet.inbox_pubkey) throw new Error("This browser does not hold the inbox key for the linked handle");
    }
    if (identityAddress) await this.publishPrivateIdentity(identityAddress);
    // A pending payment cannot be delivered until the inbox key is bound.
    // Re-sync after wallet/private-identity binding so first-time onboarding
    // receives eligible encrypted claims without requiring a page reload.
    await this.syncSession();
  }

  async publishPrivateIdentity(identityAddress: string) {
    return this.request("/v1/wallet/private-identity", { method: "POST", body: JSON.stringify({ identityAddress }) });
  }

  async resolvePrivateRecipient(input: string, expectedPool: string): Promise<string> {
    const provider = input.startsWith("@") ? "x" : "email";
    const result = await this.request<{ descriptor: { privateReady: boolean; recipientPrivateIdentityAddress?: string; privacyPoolAddress?: string } }>("/v1/resolve", {
      method: "POST",
      body: JSON.stringify({ provider, identifier: input }),
    });
    const descriptor = result.descriptor;
    if (!descriptor.privateReady || !descriptor.recipientPrivateIdentityAddress) throw new Error("Recipient has not registered a private identity");
    if (!descriptor.privacyPoolAddress || BigInt(descriptor.privacyPoolAddress) !== BigInt(expectedPool)) throw new Error("Recipient private identity uses an incompatible pool");
    return descriptor.recipientPrivateIdentityAddress;
  }

  async fundFromCircleSource(input: {
    route: WottaSourceRoute;
    denomination: Denomination;
    recipient: string;
    publicRefundRecipient: string;
    onStage?: (stage: FundingStage) => void;
    onRecovery?: (recovery: { claimSecret: string; escrow: string; expiresAt: string }) => void;
  }): Promise<{ intentId: string; sourceTxHash: string; sourceAccount: string; claimSecret: string; escrow: string; expiresAt: string; escrowed: true }> {
    const recipient = recipientIdentifier(input.recipient);
    input.onStage?.("resolving");
    const routes = await this.request<RouteManifest>("/v1/routes");
    const route = routes.routes.find((candidate) => candidate.id === input.route);
    if (!route?.enabled) throw new Error(`Cross-chain route unavailable: ${route?.reason ?? "not configured"}`);
    const escrow = routes.escrows.find((candidate) => candidate.denomination === input.denomination);
    if (!routes.router || !escrow) throw new Error("Verified CCTP router or denomination escrow is unavailable");
    const resolved = await this.request<{ descriptor: RecipientDescriptor }>("/v1/resolve", {
      method: "POST",
      body: JSON.stringify(recipient),
    });
    const recipientKey = resolved.descriptor.registered
      ? resolved.descriptor.inboxEncryptionPublicKey
      : routes.pendingDeliveryPublicKey;
    if (!recipientKey) throw new Error("Recipient inbox key is unavailable");

    input.onStage?.("connecting_source");
    const sourceAccount = input.route === "solana"
      ? await connectSolanaSource()
      : input.route === "stellar"
        ? await connectStellarSource()
        : await connectEvmSource(input.route);
    const intentId = crypto.randomUUID();
    const claimSecret = randomFelt();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
    const claimHash = computeClaimHash({ chainId: "SN_SEPOLIA", poolAddress: escrow.address, secret: claimSecret });
    const intent = {
      id: intentId,
      mode: "standard" as const,
      deliveryKind: resolved.descriptor.registered ? "registered" as const : "pending" as const,
      denomination: input.denomination,
      routeId: input.route,
      claimHash,
      publicRefundRecipient: input.publicRefundRecipient,
      expiresAt,
    };
    await this.request("/v1/intents", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(intent),
    });
    input.onStage?.("quoting");
    const signed = await this.request<SignedQuote>("/v1/quotes", {
      method: "POST",
      body: JSON.stringify({ ...intent, sourceAccount }),
    });

    // Store the recovery package before asking the source wallet to burn. If a
    // browser closes after submission, the recipient can still recover it.
    input.onStage?.("delivering");
    const envelope = encryptEnvelope({
      v: 1,
      intentId,
      claimSecret,
      escrow: escrow.address,
      denomination: input.denomination,
      expiresAt,
      chainId: "SN_SEPOLIA",
    } satisfies ClaimEnvelope, recipientKey);
    await this.request(`/v1/intents/${intentId}/delivery`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedVersion: 1,
        expiresAt,
        recipient,
        ciphertext: envelope.ciphertext,
        nonce: envelope.nonce,
        ephemeralPublicKey: envelope.ephemeralPublicKey,
        algorithm: envelope.algorithm,
      }),
    });
    input.onRecovery?.({ claimSecret, escrow: escrow.address, expiresAt });

    const sourcePlan = signed.quote.sourcePlan;
    const onEvmStage = (stage: "connecting" | "approving" | "burning" | "confirming") => {
      input.onStage?.(stage === "connecting" ? "connecting_source" : stage);
    };
    const result = input.route === "solana"
      ? await executeSolanaCctpBurn({
          plan: sourcePlan as NonEvmCctpBurnPlan,
          rpcUrl: this.config.solanaRpcUrl,
          expectedSourceAccount: sourceAccount,
          onStage: (stage) => input.onStage?.(stage === "confirming" ? "confirming" : "burning"),
        })
      : input.route === "stellar"
        ? await executeStellarCctpBurn({
            plan: sourcePlan as NonEvmCctpBurnPlan,
            rpcUrl: this.config.stellarRpcUrl,
            expectedSourceAccount: sourceAccount,
            onStage: (stage) => input.onStage?.(stage === "confirming" ? "confirming" : stage === "approving" ? "approving" : "burning"),
          })
        : await executeEvmCctpBurn({
            plan: sourcePlan as EvmCctpBurnPlan,
            expectedSourceAccount: sourceAccount,
            onStage: onEvmStage,
          });
    await this.request(`/v1/intents/${intentId}/source-submitted`, {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: 1, txHash: result.txHash }),
    });
    input.onStage?.("settling");
    await this.waitForEscrow(intentId);
    return { intentId, sourceTxHash: result.txHash, sourceAccount, claimSecret, escrow: escrow.address, expiresAt, escrowed: true };
  }

  async intent(intentId: string) {
    return this.request<{
      id: string;
      state: string;
      onchain_state?: "funded" | "claimed" | "refunded";
      source_tx_hash?: string;
      onchain_tx_hash?: string;
    }>(`/v1/intents/${encodeURIComponent(intentId)}`);
  }

  async waitForEscrow(intentId: string, timeoutMs = 15 * 60 * 1_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const intent = await this.intent(intentId);
      if (intent.onchain_state === "funded" || intent.state === "funded" || intent.state === "delivered" || intent.state === "claimable" || intent.state === "completed") return intent;
      if (intent.onchain_state === "refunded" || intent.state === "failed_terminal" || intent.state === "refunded") throw new Error(`Cross-chain payment ended in ${intent.onchain_state ?? intent.state}`);
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
    throw new Error("Source burn succeeded, but Starknet escrow confirmation is still pending. It will continue in the background.");
  }

  async loadLatestClaim(vault: PrivacyVault) {
    return this.loadClaim(vault);
  }

  async loadClaim(vault: PrivacyVault, noteId?: string) {
    const inboxSecretKey = vault.state.inboxSecretKey;
    if (!inboxSecretKey) throw new Error("This browser has no Wotta inbox key");
    await this.request("/v1/session/sync", { method: "POST" });
    const [routes, inbox] = await Promise.all([
      this.request<RouteManifest>("/v1/routes"),
      this.request<{ notes: Array<{
        id: string;
        intent_id: string;
        ciphertext: string;
        nonce: string;
        sender_public_key: string;
        algorithm: "x25519-xsalsa20-poly1305";
        intent?: { state?: string; onchain_state?: string };
      }> }>("/v1/notes"),
    ]);
    for (const note of inbox.notes) {
      if (noteId && note.id !== noteId) continue;
      if (note.intent && !["funded", "delivered", "claimable"].includes(note.intent.onchain_state ?? note.intent.state ?? "")) continue;
      let payload: ClaimEnvelope;
      try {
        payload = decryptEnvelope<ClaimEnvelope>({
          algorithm: note.algorithm,
          ciphertext: note.ciphertext,
          nonce: note.nonce,
          ephemeralPublicKey: note.sender_public_key,
        }, inboxSecretKey);
      } catch {
        continue;
      }
      if (payload.v !== 1 || payload.chainId !== "SN_SEPOLIA" || payload.intentId !== note.intent_id) continue;
      if (Date.parse(payload.expiresAt) <= Date.now()) continue;
      const escrow = routes.escrows.find((candidate) =>
        candidate.denomination === payload.denomination && sameFelt(candidate.address, payload.escrow));
      if (!escrow) continue;
      await this.request(`/v1/notes/${note.id}/delivered`, { method: "POST" });
      return {
        noteId: note.id,
        claimSecret: payload.claimSecret,
        escrow: { address: escrow.address, classHash: escrow.classHash, denomination: BigInt(escrow.denomination) },
        intentId: payload.intentId,
      };
    }
    throw new Error("No unexpired claim for a verified Wotta private escrow was found");
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) throw new Error("Sign in with Google or X first");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${data.session.access_token}`);
    // Fastify rejects content-type: application/json with an empty body
    // (FST_ERR_CTP_EMPTY_JSON_BODY). Only advertise JSON when we send a body.
    // credentials:omit avoids the API's cookie_auth_forbidden guard on POSTs.
    if (init.body != null && init.body !== "" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      credentials: "omit",
      headers,
    });
    const body = await response.json().catch(() => undefined) as (T & {
      error?: string | { message?: string; code?: string };
      message?: string;
      msg?: string;
      code?: string;
    }) | undefined;
    if (!response.ok) {
      const nestedMessage = typeof body?.error === "object" ? body.error.message : undefined;
      const nestedCode = typeof body?.error === "object" ? body.error.code : undefined;
      const message = nestedMessage ?? (typeof body?.error === "string" ? body.error : undefined) ?? body?.message ?? body?.msg;
      const code = nestedCode ?? body?.code;
      throw new Error(message ?? (code ? `${code} (${response.status}) at ${path}` : `Wotta API ${response.status} at ${path}`));
    }
    return body as T;
  }
}

function recipientIdentifier(input: string): { provider: "email" | "x"; identifier: string } {
  const value = input.trim();
  if (value.startsWith("@")) return { provider: "x", identifier: value };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { provider: "email", identifier: value };
  throw new Error("Cross-chain recipient must be an email or @handle");
}

function randomFelt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sameFelt(left: string, right: string): boolean {
  try { return BigInt(left) === BigInt(right); } catch { return false; }
}
