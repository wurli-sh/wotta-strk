import { NextResponse } from "next/server";

const EVENTS = new Set([
  "submit_enter",
  "dedup_completed",
  "dedup_in_flight",
  "wallet_request",
  "wallet_resolved",
  "receipt_success",
  "wallet_rejected",
]);

type TraceBody = {
  event?: unknown;
  requestId?: unknown;
  actionTypes?: unknown;
  transactionHash?: unknown;
};

/**
 * Development-only trace for the single outbound STRK20 Wallet API boundary.
 * Values and calldata are intentionally excluded because claim actions contain
 * a private secret. The terminal trace is safe to paste into a bug report.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  let body: TraceBody;
  try {
    body = await request.json() as TraceBody;
  } catch {
    return NextResponse.json({ error: "invalid_trace_body" }, { status: 400 });
  }

  if (
    typeof body.event !== "string"
    || !EVENTS.has(body.event)
    || typeof body.requestId !== "string"
    || !/^[a-z0-9-]{1,80}$/i.test(body.requestId)
    || !Array.isArray(body.actionTypes)
    || body.actionTypes.some((value) => typeof value !== "string")
  ) {
    return NextResponse.json({ error: "invalid_trace_event" }, { status: 400 });
  }

  const transactionHash = typeof body.transactionHash === "string"
    && /^0x[0-9a-f]+$/i.test(body.transactionHash)
    ? body.transactionHash
    : undefined;

  console.info("[wotta:strk20]", {
    event: body.event,
    requestId: body.requestId,
    actionTypes: body.actionTypes,
    ...(transactionHash ? { transactionHash } : {}),
  });
  return NextResponse.json({ ok: true });
}
