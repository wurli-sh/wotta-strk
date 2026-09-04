-- The protocol, API schema, and verified Mainnet pilot expose 0.1 USDC
-- (100000 base units). Keep the database allowlist identical.
alter table public.intents
  drop constraint if exists intents_denomination_check;

alter table public.intents
  add constraint intents_denomination_check
  check (denomination in (100000, 1000000, 10000000, 50000000, 100000000));
