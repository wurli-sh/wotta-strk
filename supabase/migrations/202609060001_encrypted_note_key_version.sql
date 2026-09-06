-- Bind every new ciphertext to the wallet inbox-key generation used to create it.
-- Historical rows stay NULL because their original key generation cannot be
-- reconstructed safely after earlier binding rotations.
alter table public.encrypted_notes
  add column if not exists recipient_key_version integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'encrypted_notes_recipient_key_version_positive'
  ) then
    alter table public.encrypted_notes
      add constraint encrypted_notes_recipient_key_version_positive
      check (recipient_key_version is null or recipient_key_version > 0) not valid;
  end if;
end $$;

alter table public.encrypted_notes
  validate constraint encrypted_notes_recipient_key_version_positive;

create index if not exists encrypted_notes_recipient_key_version
  on public.encrypted_notes(recipient_profile_id, chain_id, recipient_key_version);
