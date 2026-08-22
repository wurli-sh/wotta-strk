alter table public.intents
  add column if not exists onchain_state text check (onchain_state in ('funded', 'claimed', 'refunded')),
  add column if not exists onchain_tx_hash text,
  add column if not exists onchain_block_number bigint;

create index if not exists intents_claim_hash_lookup on public.intents(lower(claim_hash));
