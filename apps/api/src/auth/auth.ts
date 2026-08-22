import type { FastifyRequest } from "fastify";
import type { Db } from "../db/client.ts";

export type Auth = { userId: string; token: string };
export async function requireAuth(db: Db, request: FastifyRequest): Promise<Auth | null> {
  const raw = request.headers.authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  const token = raw.slice(7).trim(); if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { userId: data.user.id, token };
}
