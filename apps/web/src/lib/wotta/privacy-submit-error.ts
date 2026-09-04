const MAX_SUBMIT_ERROR_LEN = 180;

/** Collapse starknet.js RpcError dumps into a short, user-safe message. */
export function formatPrivacySubmitError(error: unknown): string {
  if (!(error instanceof Error)) return "private submission failed";
  const message = error.message.trim();
  if (!message) return "private submission failed";

  const rpcTail = message.match(/-3260\d:\s*([^"\n]+)/i)?.[1]?.trim();
  if (rpcTail) return truncateSubmitError(rpcTail);

  if (/EMPTY_PROOF_FACTS/i.test(message)) {
    return "Private pool received an empty proof — retry with a proof-aware Sepolia RPC";
  }
  if (/invalid signature/i.test(message)) {
    return "Ready private authorization signature did not verify — reconnect from Account";
  }
  if (/resources bounds.*exceed balance/i.test(message) || /exceed balance/i.test(message)) {
    return "Sepolia proof submitter is low on STRK — fund STARKNET_DEPLOYER_ADDRESS with at least 5 STRK";
  }
  if (/privacy submitter strk balance too low/i.test(message)) {
    return message.slice(0, MAX_SUBMIT_ERROR_LEN);
  }
  if (/proof-aware rpc/i.test(message)) {
    return message.slice(0, MAX_SUBMIT_ERROR_LEN);
  }
  if (message.length <= MAX_SUBMIT_ERROR_LEN) return message;

  const lastLine = message.split("\n").pop()?.trim();
  if (lastLine && lastLine.length <= MAX_SUBMIT_ERROR_LEN && !lastLine.includes("invoke_transaction")) {
    return lastLine;
  }
  return "Private proof submission was rejected by Starknet Sepolia";
}

function truncateSubmitError(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_SUBMIT_ERROR_LEN) return trimmed;
  return `${trimmed.slice(0, MAX_SUBMIT_ERROR_LEN - 1).trimEnd()}…`;
}
