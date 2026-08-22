import { createHash } from "node:crypto";
import type { Config } from "../config.ts";

export type IrisMessage = { message: string; attestation: string; messageHash: string };
/** Iris material is only returned to the settlement caller; callers must never log it. */
export async function fetchAttestation(config: Config, sourceDomain: number, transactionHash: string): Promise<IrisMessage | null> {
  const url = new URL(`/v2/messages/${sourceDomain}`, config.env.CIRCLE_IRIS_BASE_URL);
  url.searchParams.set("transactionHash", transactionHash);
  const response = await fetch(url, { headers: { accept: "application/json" } }); if (response.status === 404) return null; if (!response.ok) throw new Error(`iris_${response.status}`);
  const json = await response.json() as { messages?: { message: string; attestation: string; status?: string }[] }; const current = json.messages?.[0];
  if (!current?.message || !current.attestation || current.status !== "complete") return null;
  return { ...current, messageHash: createHash("sha256").update(Buffer.from(current.message.replace(/^0x/, ""), "hex")).digest("hex") };
}
