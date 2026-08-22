import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.ts";

export async function acquireLease(db: Db, name: string, seconds = 30): Promise<string | null> {
  const holder = randomUUID(), expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
  const { data, error } = await db.rpc("try_acquire_worker_lease", { p_name: name, p_holder: holder, p_expires_at: expiresAt });
  if (error) throw error; return data === true ? holder : null;
}
