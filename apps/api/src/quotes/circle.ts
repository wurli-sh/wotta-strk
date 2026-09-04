export const FEE_BUFFER_BPS = 2_000n;
const USDC_DECIMALS = 6;

export async function quoteCircleExactNet(input: {
  irisBaseUrl: string;
  sourceDomain: number;
  destinationDomain: number;
  requestedReceive: bigint;
  minFinalityThreshold: number;
  fetchImpl?: typeof fetch;
}) {
  const base = input.irisBaseUrl.replace(/\/$/, "");
  const response = await (input.fetchImpl ?? fetch)(`${base}/v2/burn/USDC/fees/${safeDomain(input.sourceDomain)}/${safeDomain(input.destinationDomain)}`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`iris_fee_http_${response.status}`);
  const body = await response.json() as unknown;
  if (!Array.isArray(body)) throw new Error("iris_fee_invalid");
  const selected = body.find((entry) => entry && typeof entry === "object" && Number((entry as { finalityThreshold?: unknown }).finalityThreshold) === input.minFinalityThreshold) as { minimumFee?: unknown } | undefined;
  if (!selected) throw new Error("iris_fee_finality_unavailable");
  const feeBps = decimalRational(selected.minimumFee);
  const quote = solveExactNet(input.requestedReceive, (gross) => {
    const protocolFee = ceilDiv(gross * feeBps.numerator, feeBps.denominator * 10_000n);
    return protocolFee + ceilDiv(protocolFee * FEE_BUFFER_BPS, 10_000n);
  });
  if (input.minFinalityThreshold <= 1000) {
    const allowanceResponse = await (input.fetchImpl ?? fetch)(`${base}/v2/fastBurn/USDC/allowance`, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/json" },
    });
    if (!allowanceResponse.ok) throw new Error(`iris_allowance_http_${allowanceResponse.status}`);
    const allowanceBody = await allowanceResponse.json() as { allowance?: unknown };
    const allowance = decimalTokenUnits(allowanceBody?.allowance, USDC_DECIMALS);
    if (allowance < quote.grossDebit) throw new Error("circle_fast_allowance_insufficient");
  }
  return quote;
}

export function solveExactNet(requestedReceive: bigint, feeForGross: (gross: bigint) => bigint) {
  if (requestedReceive <= 0n) throw new Error("requested_receive_invalid");
  let gross = requestedReceive;
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const maxFee = feeForGross(gross);
    if (maxFee < 0n || maxFee >= gross) throw new Error("circle_fee_invalid");
    const minimumReceive = gross - maxFee;
    if (minimumReceive >= requestedReceive) return { grossDebit: gross, maxFee, minimumReceive };
    gross += requestedReceive - minimumReceive;
  }
  throw new Error("exact_net_did_not_converge");
}

export function decimalRational(value: unknown) {
  if ((typeof value !== "string" && typeof value !== "number") || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value))) throw new Error("circle_fee_invalid");
  const [whole = "0", fraction = ""] = String(value).split(".");
  return { numerator: BigInt(`${whole}${fraction}`), denominator: 10n ** BigInt(fraction.length) };
}

/** Parse a non-negative decimal amount without floating-point arithmetic. */
export function decimalTokenUnits(value: unknown, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("circle_allowance_invalid");
  if ((typeof value !== "string" && typeof value !== "number") || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value))) {
    throw new Error("circle_allowance_invalid");
  }
  const [whole = "0", fraction = ""] = String(value).split(".");
  const scale = 10n ** BigInt(decimals);
  const fractionUnits = fraction.length === 0
    ? 0n
    : BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
  return BigInt(whole) * scale + fractionUnits;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) throw new Error("circle_fee_invalid");
  return (numerator + denominator - 1n) / denominator;
}

function safeDomain(value: number) {
  if (!Number.isInteger(value) || value < 0) throw new Error("circle_domain_invalid");
  return String(value);
}
