#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
fi

# Supabase's direct database hostname can be IPv6-only. Prefer the session
# pooler URI when supplied while keeping DATABASE_URL compatible with CI.
if [[ -n "${DATABASE_POOLER_URL:-}" ]]; then
  DATABASE_URL="$DATABASE_POOLER_URL"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required; add it to .env or export it before running migrations." >&2
  exit 1
fi

psql "$DATABASE_URL" --set ON_ERROR_STOP=1 <<'SQL'
create table if not exists public.wotta_schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
insert into public.wotta_schema_migrations(name)
select '202608200001_phase2.sql' where to_regclass('public.profiles') is not null
on conflict do nothing;
insert into public.wotta_schema_migrations(name)
select '202608210002_cctp_relayer.sql' where exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='relayer_jobs' and column_name='destination_tx_hash'
) on conflict do nothing;
insert into public.wotta_schema_migrations(name)
select '202608210003_private_identity_bindings.sql' where exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='wallet_bindings' and column_name='private_identity_address'
) on conflict do nothing;
insert into public.wotta_schema_migrations(name)
select '202608210004_encrypted_note_sender_key.sql' where exists (
  select 1 from information_schema.columns where table_schema='public' and table_name='encrypted_notes' and column_name='sender_public_key'
) on conflict do nothing;
SQL

for migration in supabase/migrations/*.sql; do
  name="$(basename "$migration")"
  applied="$(psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --tuples-only --no-align --command "select 1 from public.wotta_schema_migrations where name = '$name'")"
  if [[ "$applied" == "1" ]]; then
    continue
  fi
  psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --single-transaction --file "$migration" --command "insert into public.wotta_schema_migrations(name) values ('$name')"
done
