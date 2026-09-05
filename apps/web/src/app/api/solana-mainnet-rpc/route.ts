import { NextResponse } from "next/server";

/**
 * Same-origin Solana JSON-RPC proxy for browser burns.
 *
 * Solana Labs public mainnet endpoints return 403 when the request carries a
 * browser `Origin` header. The browser talks to this route (localhost / app
 * origin); we forward to SOLANA_MAINNET_RPC_URL without that Origin.
 *
 * Dedicated provider URLs still work for NEXT_PUBLIC_* when available — this
 * route is the no-paid-RPC local/pilot path.
 */
function upstreamUrl(): string {
  return process.env.SOLANA_MAINNET_RPC_URL?.trim() || "https://api.mainnet.solana.com";
}

export async function POST(request: Request) {
  let body: string;
  try {
    body = await request.text();
    JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid_json_rpc_body" }, { status: 400 });
  }

  const upstream = upstreamUrl();
  let response: Response;
  try {
    response = await fetch(upstream, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "solana_upstream_unreachable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
