#!/usr/bin/env node
/**
 * Dev-only reset for the Sepolia privacy identity migration.
 * Uses Supabase HTTPS REST (service role) so it works when direct Postgres/psql
 * is unreachable (common IPv6 routing issues with db.*.supabase.co).
 */
const url = process.env.SUPABASE_URL?.trim()?.replace(/\/$/, "");
const key = process.env.SUPABASE_SECRET_KEY?.trim();
if (!url || !key) {
  process.stderr.write("SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env\n");
  process.exit(1);
}

const full = process.argv.includes("--full");

function restHeaders(prefer = "count=exact") {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function restCount(method, path, body) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: restHeaders("count=exact"),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
  }
  const range = response.headers.get("content-range") ?? "*/0";
  const count = Number(range.split("/")[1] ?? 0);
  return Number.isFinite(count) ? count : 0;
}

async function main() {
  const clearedPrivateIdentityBindings = await restCount(
    "PATCH",
    "wallet_bindings?private_identity_address=not.is.null",
    {
      private_identity_address: null,
      privacy_pool_address: null,
      private_identity_verified_at: null,
    },
  );

  const summary = {
    status: "ok",
    transport: "supabase-rest",
    full,
    clearedPrivateIdentityBindings,
  };

  if (full) {
    const deletes = [
      ["relayer_jobs", "id=neq.00000000-0000-0000-0000-000000000000"],
      ["intent_events", "id=gt.0"],
      ["encrypted_notes", "id=neq.00000000-0000-0000-0000-000000000000"],
      ["pending_claims", "id=neq.00000000-0000-0000-0000-000000000000"],
      ["intents", "id=neq.00000000-0000-0000-0000-000000000000"],
    ];
    for (const [table, filter] of deletes) {
      summary[`deleted_${table}`] = await restCount("DELETE", `${table}?${filter}`);
    }
  }

  const remainingPrivateBindings = await restCount(
    "GET",
    "wallet_bindings?select=id&private_identity_address=not.is.null",
  );
  const remainingIntents = await restCount(
    "GET",
    "intents?select=id",
  );

  process.stdout.write(`${JSON.stringify({
    ...summary,
    remainingPrivateBindings,
    remainingIntents,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
