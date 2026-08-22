alter table public.encrypted_notes
  add column sender_public_key text;

alter table public.encrypted_notes
  add constraint encrypted_notes_sender_public_key_required
  check (sender_public_key is not null and sender_public_key ~ '^[A-Za-z0-9_-]{43}$') not valid;

-- Existing development rows predate decryptable envelopes. Purge them rather
-- than pretending they can be recovered without the sender's X25519 key.
delete from public.encrypted_notes where sender_public_key is null;

alter table public.encrypted_notes
  validate constraint encrypted_notes_sender_public_key_required;

alter table public.encrypted_notes
  alter column sender_public_key set not null;
