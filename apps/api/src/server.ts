import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { deliverySchema, idempotencySchema, intentSchema, privateIdentityBindingSchema, quoteSchema, resolveSchema, sourceSubmittedSchema, walletChallengeSchema, walletLinkSchema } from "@wotta/shared";
import { assertMainnetSourceRpcNetworks, assertMainnetWorkerReadiness, assertStarknetRpcNetwork, loadConfig } from "./config.ts";
import { createDb } from "./db/client.ts";
import { createLogger, safeError } from "./logger.ts";
import { requireAuth } from "./auth/auth.ts";
import { createWalletChallenge, consumeWalletChallenge, requireWalletOrigin } from "./auth/challenge.ts";
import { bindPrivateIdentity } from "./auth/private-identity.ts";
import { activeWalletBindingForProfile } from "./auth/wallet-bindings.ts";
import { syncProfileIdentities } from "./auth/sync.ts";
import { resolveDescriptor } from "./resolver/descriptors.ts";
import { pendingDeliveryPublicKey, storeDelivery } from "./delivery/pending.ts";
import { createIntent, getIntent, markSourceSubmitted, sameInstant, signQuote, transition } from "./intents/service.ts";
import { cancelIntent, recoveryHintFor, transitionToward } from "./intents/recovery.ts";
import { idempotent } from "./intents/idempotency.ts";
import { routesForConfig, starknetEscrowInboxReady, verifiedEscrowPoolsForConfig } from "./routes.ts";
import { openApiDocument } from "./openapi/document.ts";
import { requestChainId, rpcUrlForChainId } from "./network-scope.ts";
import { runIndexerLoop } from "./indexer/run.ts";
import { runRelayerLoop } from "./relayer/run.ts";
import { healthBody, loadRelayerQueueHealth } from "./relayer/health.ts";
import { Account, RpcProvider, Signer } from "starknet";

type Deps = ReturnType<typeof deps>; function deps(config = loadConfig()) { return { config, db: createDb(config), log: createLogger(config) }; }
function parse<T>(schema: z.ZodType<T>, body: unknown): T { const result = schema.safeParse(body); if (!result.success) throw new Error(`invalid_body:${result.error.issues[0]?.path.join(".") ?? "value"}`); return result.data; }
function errorReply(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown) { const message = safeError(error); const status = message === "unauthorized" ? 401 : message === "not_found" ? 404 : message === "route_paused" ? 503 : message.includes("route_disabled") || message.includes("identity_already_linked") || message.includes("wallet_already_linked") || message.includes("wallet_inbox_key_mismatch") || message.includes("wallet_binding_ambiguous") || message.includes("invalid_") || message.includes("challenge_") || message.includes("signature_") || message.includes("version_conflict") || message.includes("idempotency_") ? 409 : 400; return reply.code(status).send({ error: { code: message.split(":")[0], message } }); }

export async function buildServer(d = deps()) {
  const app = Fastify({ bodyLimit: 256 * 1024, loggerInstance: d.log });
  await app.register(cors, { origin: d.config.corsOrigins, credentials: false });
  app.addHook("onRequest", async (request, reply) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.url.startsWith("/v1/") && request.headers.cookie) return reply.code(400).send({ error: { code: "cookie_auth_forbidden" } }); });
  app.addHook("onSend", async (_request, reply) => { reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("X-Frame-Options", "DENY").header("Referrer-Policy", "no-referrer"); });
  app.get("/v1/health", async () => {
    let strkAlert: boolean | null = null;
    if (d.config.env.RUN_RELAYER) {
      try {
        const address = d.config.env.STARKNET_RELAYER_ADDRESS ?? d.config.env.STARKNET_DEPLOYER_ADDRESS;
        const rawKey = d.config.env.STARKNET_RELAYER_PRIVATE_KEY ?? d.config.env.STARKNET_RELAYER_KEY_OR_KEYSTORE ?? d.config.env.STARKNET_DEPLOYER_PRIVATE_KEY;
        const key = rawKey && !rawKey.startsWith("0x") ? `0x${rawKey}` : rawKey;
        if (address && key && /^0x[0-9a-f]+$/i.test(key)) {
          const account = new Account({
            provider: new RpcProvider({ nodeUrl: d.config.env.STARKNET_RPC_URL }),
            address,
            signer: new Signer(key),
          });
          const result = await account.provider.callContract({
            contractAddress: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
            entrypoint: "balanceOf",
            calldata: [account.address],
          });
          const balance = BigInt(result[0] ?? 0) + (BigInt(result[1] ?? 0) << 128n);
          strkAlert = balance < d.config.env.STARKNET_RELAYER_ALERT_BALANCE_WEI;
        }
      } catch {
        strkAlert = null;
      }
    }
    const queue = await loadRelayerQueueHealth(d.db, { strkAlert });
    return healthBody(d.config, routesForConfig(d.config).filter((route) => route.enabled).length, queue);
  });
  app.get("/v1/routes", async () => ({
    routes: routesForConfig(d.config),
    manifestHash: d.config.manifestHash,
    pendingDeliveryPublicKey: pendingDeliveryPublicKey(d.config),
    router: d.config.manifest.router.verification.status === "verified"
      ? d.config.manifest.router.address
      : undefined,
    escrows: d.config.manifest.router.verification.status === "verified"
      ? verifiedEscrowPoolsForConfig(d.config)
          .map((pool) => ({ denomination: pool.denomination, address: pool.address, classHash: pool.classHash }))
      : [],
    privacyPool: d.config.manifest.walletManagedPrivacy?.status === "verified"
      ? d.config.manifest.walletManagedPrivacy.poolAddress
      : d.config.manifest.directPrivacy?.status === "verified"
        ? d.config.manifest.directPrivacy.poolAddress
        : undefined,
    chainId: d.config.manifest.chainId,
  }));
  app.get("/v1/openapi.json", async () => openApiDocument());
  app.post("/v1/session/sync", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { const session = await syncProfileIdentities(d.db, auth.token); if (d.config.manifest.chainId === "SN_MAIN") return { ...session, pendingDelivered: 0 }; const { deliverPendingForProfile } = await import("./delivery/pending.ts"); return { ...session, pendingDelivered: await deliverPendingForProfile(d.db, d.config, session.profileId, session.synced) }; } catch (error) { return errorReply(reply, error); } });
  app.get("/v1/me", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    const chainId = requestChainId(d.config, request);
    const [profile, identities, wallet] = await Promise.all([
      d.db.from("profiles").select("*").eq("id", auth.userId).maybeSingle(),
      d.db.from("identities").select("provider,normalized_identifier,verified_at").eq("profile_id", auth.userId).is("revoked_at", null),
      activeWalletBindingForProfile(d.db, auth.userId, chainId, { dedupe: true }),
    ]);
    return { profile: profile.data, identities: identities.data ?? [], wallet };
  });
  app.post("/v1/wallet/challenge", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(walletChallengeSchema, request.body), origin = requireWalletOrigin(d.config, request.headers.origin); const chainId = requestChainId(d.config, request); return await createWalletChallenge(d.db, d.config, auth.userId, body.address, origin, chainId); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/wallet/link", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(walletLinkSchema, request.body), origin = requireWalletOrigin(d.config, request.headers.origin); const chainId = requestChainId(d.config, request); const rpcUrl = rpcUrlForChainId(d.config, chainId); return await consumeWalletChallenge(d.db, d.config, auth.userId, JSON.parse(body.challenge) as never, body.signature, body.inboxPublicKey, origin, chainId, rpcUrl); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/wallet/private-identity", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(privateIdentityBindingSchema, request.body); return await bindPrivateIdentity(d.db, d.config, auth.userId, body.identityAddress); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/wallet/unlink", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    const chainId = requestChainId(d.config, request);
    const { data, error } = await d.db
      .from("wallet_bindings")
      .update({ revoked_at: new Date().toISOString() })
      .eq("profile_id", auth.userId)
      .eq("chain_id", chainId)
      .is("revoked_at", null)
      .select("address");
    if (error) return errorReply(reply, error);
    return { unlinked: data?.length ?? 0 };
  });
  app.post("/v1/resolve", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(resolveSchema, request.body); return await resolveDescriptor(d.db, d.config, body.provider, body.identifier); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/quotes", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); try { return await signQuote(d.db, d.config, auth.userId, parse(quoteSchema, request.body)); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/intents", async (request, reply) => { const auth = await requireAuth(d.db, request), key = request.headers["idempotency-key"]; if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(intentSchema, request.body), idempotencyKey = idempotencySchema.parse(key); const output = await idempotent(d.db, auth.userId, idempotencyKey, body, () => createIntent(d.db, d.config, auth.userId, body)); return reply.code(201).send(output); } catch (error) { return errorReply(reply, error); } });
  app.get("/v1/intents", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); const rawLimit = Number((request.query as { limit?: string }).limit ?? 25); const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 25; const { data, error } = await d.db.from("intents").select("id,mode,delivery_kind,denomination,route_id,state,version,source_tx_hash,onchain_state,onchain_tx_hash,onchain_block_number,expires_at,created_at,updated_at").eq("owner_id", auth.userId).order("created_at", { ascending: false }).limit(limit); return error ? errorReply(reply, error) : { intents: data ?? [] }; });
  app.get("/v1/intents/:id", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    try {
      const intent = await getIntent(d.db, auth.userId, String((request.params as { id: string }).id));
      const { data: job } = await d.db.from("relayer_jobs").select("created_at,status,attempts").eq("intent_id", intent.id).maybeSingle();
      return {
        ...intent,
        recoveryHint: recoveryHintFor({
          state: intent.state,
          onchain_state: intent.onchain_state,
          updated_at: intent.updated_at,
          created_at: intent.created_at,
          route_id: intent.route_id,
          jobCreatedAt: job?.created_at ?? null,
        }),
      };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.post("/v1/intents/:id/cancel", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    try {
      const body = parse(z.object({ expectedVersion: z.number().int().nonnegative() }), request.body);
      return await cancelIntent(d.db, auth.userId, String((request.params as { id: string }).id), body.expectedVersion);
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.post("/v1/intents/:id/source-submitted", async (request, reply) => { const auth = await requireAuth(d.db, request), key = request.headers["idempotency-key"]; if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(sourceSubmittedSchema.extend({ expectedVersion: z.number().int().nonnegative() }), request.body), idempotencyKey = idempotencySchema.parse(key), id = String((request.params as { id: string }).id); return await idempotent(d.db, auth.userId, idempotencyKey, body, () => markSourceSubmitted(d.db, auth.userId, id, body.expectedVersion, body.txHash)); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/intents/:id/delivery", async (request, reply) => { const auth = await requireAuth(d.db, request), key = request.headers["idempotency-key"]; if (!auth) return errorReply(reply, new Error("unauthorized")); try { const body = parse(deliverySchema.extend({ expectedVersion: z.number().int().nonnegative(), expiresAt: z.string().datetime() }), request.body), idempotencyKey = idempotencySchema.parse(key), id = String((request.params as { id: string }).id); return await idempotent(d.db, auth.userId, idempotencyKey, body, async () => { const current = await getIntent(d.db, auth.userId, id); if (current.version !== body.expectedVersion || !sameInstant(current.expires_at, body.expiresAt) || Date.parse(body.expiresAt) <= Date.now()) throw new Error("delivery_intent_mismatch"); const delivery = await storeDelivery(d.db, d.config, { senderId: auth.userId, intentId: id, recipient: body.recipient, ephemeralPublicKey: body.ephemeralPublicKey, ciphertext: body.ciphertext, nonce: body.nonce, algorithm: body.algorithm, expiresAt: body.expiresAt }); const intent = current.state === "funded" ? await transition(d.db, auth.userId, id, body.expectedVersion, "delivered", { delivery }) : current; return { intent, delivery, queuedUntilFunded: current.state !== "funded" }; }); } catch (error) { return errorReply(reply, error); } });
  app.post("/v1/intents/:id/refund-observed", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    try {
      const intent = await getIntent(d.db, auth.userId, String((request.params as { id: string }).id));
      if (intent.onchain_state !== "refunded") {
        return reply.code(202).send({ accepted: false, intentId: intent.id, reason: "awaiting_indexer" });
      }
      if (intent.state === "refunded") return { accepted: true, intentId: intent.id, intent };
      const updated = await transitionToward(
        d.db,
        auth.userId,
        intent.id,
        intent.version,
        intent.state,
        "refunded",
        { refundObserved: true },
      );
      return { accepted: true, intentId: intent.id, intent: updated };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.get("/v1/notes", async (request, reply) => {
    const auth = await requireAuth(d.db, request);
    if (!auth) return errorReply(reply, new Error("unauthorized"));
    if (d.config.manifest.chainId === "SN_MAIN" && !starknetEscrowInboxReady(d.config)) return errorReply(reply, new Error("route_disabled:awaiting_verified_escrow_deployment"));
    const { data: notes, error } = await d.db
      .from("encrypted_notes")
      .select("id,intent_id,ciphertext,nonce,sender_public_key,algorithm,version,delivered_at,created_at")
      .eq("recipient_profile_id", auth.userId)
      .order("created_at", { ascending: false });
    if (error) return errorReply(reply, error);
    const intentIds = [...new Set((notes ?? []).map((note) => note.intent_id))];
    if (intentIds.length === 0) return { notes: [] };
    const { data: relatedIntents, error: intentError } = await d.db
      .from("intents")
      .select("id,denomination,state,onchain_state,expires_at,route_id,source_tx_hash,onchain_tx_hash")
      .in("id", intentIds);
    if (intentError) return errorReply(reply, intentError);
    const byIntent = new Map((relatedIntents ?? []).map((intent) => [intent.id, intent]));
    return {
      notes: (notes ?? []).flatMap((note) => {
        const intent = byIntent.get(note.intent_id);
        return intent ? [{ ...note, intent }] : [];
      }),
    };
  });
  app.post("/v1/notes/:id/delivered", async (request, reply) => { const auth = await requireAuth(d.db, request); if (!auth) return errorReply(reply, new Error("unauthorized")); if (d.config.manifest.chainId === "SN_MAIN" && !starknetEscrowInboxReady(d.config)) return errorReply(reply, new Error("route_disabled:awaiting_verified_escrow_deployment")); const { data, error } = await d.db.from("encrypted_notes").update({ delivered_at: new Date().toISOString() }).eq("id", String((request.params as { id: string }).id)).eq("recipient_profile_id", auth.userId).select("id").maybeSingle(); return error ? errorReply(reply, error) : data ? { ok: true } : errorReply(reply, new Error("not_found")); });
  return app;
}
async function main() {
  const config = loadConfig();
  await assertStarknetRpcNetwork(config);
  await assertMainnetSourceRpcNetworks(config);
  const d = deps(config);
  const app = await buildServer(d);
  const workers = new AbortController();
  const workerTasks: Promise<void>[] = [];
  if (config.env.RUN_INDEXER || config.env.RUN_RELAYER || config.env.STARKNET_PRIVATE_ADMITTED) {
    assertMainnetWorkerReadiness(config);
  }
  if (config.env.RUN_INDEXER) workerTasks.push(runIndexerLoop(d, workers.signal));
  if (config.env.RUN_RELAYER) workerTasks.push(runRelayerLoop(d, workers.signal));
  const close = async () => {
    workers.abort();
    await Promise.allSettled(workerTasks);
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(safeError(error)); process.exit(1); });
