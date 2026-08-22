import type { Db } from "../db/client.ts";
import { requestHash } from "./service.ts";
export async function idempotent<T>(db: Db, ownerId: string, key: string, request: unknown, action: () => Promise<T>): Promise<T> {
  const hash = requestHash(request); const { data, error } = await db.from("idempotency_keys").select("request_hash,response").eq("owner_id", ownerId).eq("key", key).maybeSingle(); if (error) throw error;
  if (data) { if (data.request_hash !== hash) throw new Error("idempotency_mismatch"); return data.response as T; }
  const response = await action(); const { error: saveError } = await db.from("idempotency_keys").insert({ owner_id: ownerId, key, request_hash: hash, response }); if (saveError?.code === "23505") return idempotent(db, ownerId, key, request, action); if (saveError) throw saveError; return response;
}
