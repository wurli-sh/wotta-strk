-- Testnet and Mainnet share Supabase, but an intent (and its encrypted note)
-- belongs to exactly one Starknet destination. Historical rows predate this
-- column and were created by the Sepolia-only product, so backfill them there.
alter table public.intents
  add column if not exists chain_id text not null default 'SN_SEPOLIA'
  check (chain_id in ('SN_SEPOLIA', 'SN_MAIN'));

create index if not exists intents_owner_chain_created_at
  on public.intents(owner_id, chain_id, created_at desc);

create index if not exists intents_chain_claim_hash
  on public.intents(chain_id, claim_hash);

-- Pending deliveries are also backed by the shared database. Claim only rows
-- whose associated intent belongs to the requesting API's destination chain.
drop function if exists public.claim_pending_claims(uuid, text[], uuid);
create function public.claim_pending_claims(
  p_profile_id uuid,
  p_lookup_hashes text[],
  p_token uuid,
  p_chain_id text
)
returns table(id uuid, intent_id uuid, sender_profile_id uuid, sealed_payload text)
language plpgsql security definer set search_path = public as $$
declare row pending_claims%rowtype;
begin
  for row in
    select p.*
    from pending_claims p
    join intents i on i.id = p.intent_id
    where p.delivered_at is null
      and p.expires_at > now()
      and p.recipient_lookup_hash = any(p_lookup_hashes)
      and i.chain_id = p_chain_id
      and (p.processing_expires_at is null or p.processing_expires_at < now())
    for update of p skip locked
  loop
    update pending_claims
      set processing_token = p_token, processing_expires_at = now() + interval '5 minutes'
      where pending_claims.id = row.id;
    id := row.id;
    intent_id := row.intent_id;
    sender_profile_id := row.sender_profile_id;
    sealed_payload := row.sealed_payload;
    return next;
  end loop;
  return;
end $$;
revoke all on function public.claim_pending_claims(uuid, text[], uuid, text) from public, anon, authenticated;
grant execute on function public.claim_pending_claims(uuid, text[], uuid, text) to service_role;
