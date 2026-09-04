-- Wotta Phase 2: all secret-bearing application writes use the service client.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.identities (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google','x')), provider_subject text not null,
  normalized_identifier text not null, verified_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(),
  unique(provider, provider_subject)
);
create unique index identities_active_identifier on public.identities(provider, normalized_identifier) where revoked_at is null and verified_at is not null;
create table public.wallet_bindings (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  address text not null, chain_id text not null default 'SN_MAIN', inbox_pubkey text not null, key_version integer not null default 1,
  challenge_verified_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create unique index wallet_bindings_active_address on public.wallet_bindings(chain_id, lower(address)) where revoked_at is null;
create unique index wallet_bindings_active_profile on public.wallet_bindings(profile_id) where revoked_at is null;
create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  nonce_hash text not null unique, challenge_hash text not null, address text not null, purpose text not null check (purpose = 'wallet_link'), origin text not null,
  issued_at timestamptz not null default now(), expires_at timestamptz not null, consumed_at timestamptz
);
create table public.intents (
  id uuid primary key, owner_id uuid not null references public.profiles(id), mode text not null check(mode in ('standard','private')),
  delivery_kind text not null check(delivery_kind in ('registered','pending','direct')), denomination numeric(78,0) not null check(denomination in (100000,1000000,10000000,50000000,100000000)),
  route_id text not null, claim_hash text not null unique, refund_hash text unique, public_refund_recipient text, expires_at timestamptz not null,
  state text not null default 'draft', version integer not null default 0, source_tx_hash text, quote jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.intent_events (
  id bigint generated always as identity primary key, intent_id uuid not null references public.intents(id) on delete cascade,
  from_state text, to_state text not null, version integer not null, evidence jsonb not null default '{}'::jsonb, payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  unique(intent_id, version)
);
create table public.idempotency_keys (owner_id uuid not null references public.profiles(id), key uuid not null, request_hash text not null, response jsonb not null, created_at timestamptz not null default now(), primary key(owner_id,key));
create table public.encrypted_notes (
  id uuid primary key default gen_random_uuid(), recipient_profile_id uuid not null references public.profiles(id), sender_profile_id uuid references public.profiles(id), intent_id uuid not null references public.intents(id),
  ciphertext text not null, nonce text not null, algorithm text not null check(algorithm = 'x25519-xsalsa20-poly1305'), version integer not null default 1, delivered_at timestamptz, created_at timestamptz not null default now(),
  unique(recipient_profile_id, intent_id)
);
create table public.pending_claims (
  id uuid primary key default gen_random_uuid(), sender_profile_id uuid not null references public.profiles(id), recipient_lookup_hash text not null,
  intent_id uuid not null unique references public.intents(id), sealed_payload text not null, key_version integer not null, expires_at timestamptz not null,
  delivered_profile_id uuid references public.profiles(id), delivered_at timestamptz, purge_after timestamptz, processing_token uuid, processing_expires_at timestamptz, created_at timestamptz not null default now()
);
create index pending_claims_lookup on public.pending_claims(recipient_lookup_hash) where delivered_at is null;
create table public.chain_events (id bigint generated always as identity primary key, chain_id text not null, block_number bigint not null, block_hash text not null, tx_hash text not null, event_index integer not null, kind text not null, intent_id uuid references public.intents(id), payload jsonb not null, canonical boolean not null default true, created_at timestamptz not null default now(), unique(chain_id,tx_hash,event_index));
create table public.indexer_cursors (chain_id text primary key, block_number bigint not null, block_hash text not null, updated_at timestamptz not null default now());
create table public.relayer_jobs (id uuid primary key default gen_random_uuid(), intent_id uuid not null unique references public.intents(id), status text not null default 'queued', attempts integer not null default 0, lease_until timestamptz, message_hash text, last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.worker_leases (name text primary key, holder text not null, expires_at timestamptz not null, updated_at timestamptz not null default now());

alter table public.profiles enable row level security; alter table public.profiles force row level security;
alter table public.identities enable row level security; alter table public.identities force row level security;
alter table public.wallet_bindings enable row level security; alter table public.wallet_bindings force row level security;
alter table public.wallet_challenges enable row level security; alter table public.wallet_challenges force row level security;
alter table public.intents enable row level security; alter table public.intents force row level security;
alter table public.intent_events enable row level security; alter table public.intent_events force row level security;
alter table public.idempotency_keys enable row level security; alter table public.idempotency_keys force row level security;
alter table public.encrypted_notes enable row level security; alter table public.encrypted_notes force row level security;
alter table public.pending_claims enable row level security; alter table public.pending_claims force row level security;
alter table public.chain_events enable row level security; alter table public.chain_events force row level security;
alter table public.indexer_cursors enable row level security; alter table public.indexer_cursors force row level security;
alter table public.relayer_jobs enable row level security; alter table public.relayer_jobs force row level security;
alter table public.worker_leases enable row level security; alter table public.worker_leases force row level security;
create policy "own profile" on public.profiles for select using (id = auth.uid());
create policy "own identities" on public.identities for select using (profile_id = auth.uid());
create policy "own wallets" on public.wallet_bindings for select using (profile_id = auth.uid());
create policy "own challenges" on public.wallet_challenges for select using (profile_id = auth.uid());
create policy "own intents" on public.intents for select using (owner_id = auth.uid());
create policy "own intent events" on public.intent_events for select using (exists(select 1 from public.intents i where i.id=intent_id and i.owner_id=auth.uid()));
create policy "inbox parties only" on public.encrypted_notes for select using (recipient_profile_id=auth.uid() or sender_profile_id=auth.uid());
revoke all on public.pending_claims, public.chain_events, public.indexer_cursors, public.relayer_jobs, public.worker_leases, public.idempotency_keys from anon, authenticated;

-- This function runs as definer so the browser never reads pending ciphertext.
create or replace function public.claim_pending_claims(p_profile_id uuid, p_lookup_hashes text[], p_token uuid)
returns table(id uuid, intent_id uuid, sender_profile_id uuid, sealed_payload text) language plpgsql security definer set search_path = public as $$
declare row pending_claims%rowtype;
begin
  for row in select * from pending_claims where delivered_at is null and expires_at > now() and recipient_lookup_hash = any(p_lookup_hashes) and (processing_expires_at is null or processing_expires_at < now()) for update skip locked loop
    update pending_claims set processing_token=p_token, processing_expires_at=now()+interval '5 minutes' where pending_claims.id=row.id;
    id := row.id; intent_id := row.intent_id; sender_profile_id := row.sender_profile_id; sealed_payload := row.sealed_payload; return next;
  end loop;
  return;
end $$;
revoke all on function public.claim_pending_claims(uuid, text[], uuid) from public, anon, authenticated;
grant execute on function public.claim_pending_claims(uuid, text[], uuid) to service_role;

create or replace function public.try_acquire_worker_lease(p_name text, p_holder text, p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare acquired boolean;
begin
  insert into worker_leases(name, holder, expires_at) values (p_name, p_holder, p_expires_at)
  on conflict(name) do update set holder=excluded.holder, expires_at=excluded.expires_at, updated_at=now()
  where worker_leases.expires_at < now() or worker_leases.holder = excluded.holder
  returning true into acquired;
  return coalesce(acquired, false);
end $$;
revoke all on function public.try_acquire_worker_lease(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.try_acquire_worker_lease(text, text, timestamptz) to service_role;
