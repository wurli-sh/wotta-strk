-- One Wotta profile can bind one Ready account on each Starknet network.
drop index if exists public.wallet_bindings_active_profile;
create unique index wallet_bindings_active_profile_chain
  on public.wallet_bindings(profile_id, chain_id)
  where revoked_at is null;

-- Private recipients are scoped to both the chain and the privacy pool.
drop index if exists public.wallet_bindings_active_private_identity;
create unique index wallet_bindings_active_private_identity_pool
  on public.wallet_bindings(chain_id, lower(privacy_pool_address), lower(private_identity_address))
  where revoked_at is null
    and privacy_pool_address is not null
    and private_identity_address is not null;

-- Challenges are short-lived, but chain scoping prevents a valid signature
-- created for one API deployment from being consumed by the other.
alter table public.wallet_challenges
  add column if not exists chain_id text not null default 'SN_SEPOLIA';
create index if not exists wallet_challenges_profile_chain
  on public.wallet_challenges(profile_id, chain_id, expires_at);
