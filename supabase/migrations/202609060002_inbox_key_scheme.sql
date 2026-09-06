-- Distinguish device-random legacy inbox keys from deterministic Ready-derived
-- keys. Existing rows fail safe as legacy and are offered an explicit upgrade.
alter table public.wallet_bindings
  add column if not exists inbox_key_scheme text not null default 'legacy_random';

alter table public.wallet_bindings
  drop constraint if exists wallet_bindings_inbox_key_scheme_valid;

alter table public.wallet_bindings
  add constraint wallet_bindings_inbox_key_scheme_valid
  check (inbox_key_scheme in ('legacy_random', 'ready_derived_v1')) not valid;

alter table public.wallet_bindings
  validate constraint wallet_bindings_inbox_key_scheme_valid;
