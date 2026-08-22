import { pino } from "pino";
import type { Config } from "./config.ts";

export const REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie", "authorization", "cookie", "signature", "ciphertext", "sealed_payload", "token", "claimSecret", "refundSecret", "*.privateKey"];
export function createLogger(config: Config) { return pino({ level: config.env.LOG_LEVEL, redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }); }
export function safeError(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "unknown_error";
  return raw
    .replace(/(0x)?[\da-f]{64,}/gi, "[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 512);
}
