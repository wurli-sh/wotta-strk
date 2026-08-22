alter table public.wallet_bindings
  add column private_identity_address text,
  add column privacy_pool_address text,
  add column private_identity_verified_at timestamptz;

create unique index wallet_bindings_active_private_identity
  on public.wallet_bindings(chain_id, lower(private_identity_address))
  where revoked_at is null and private_identity_address is not null;

alter table public.wallet_bindings
  add constraint wallet_bindings_private_identity_complete check (
    (private_identity_address is null and privacy_pool_address is null and private_identity_verified_at is null)
    or
    (private_identity_address is not null and privacy_pool_address is not null and private_identity_verified_at is not null)
  );
