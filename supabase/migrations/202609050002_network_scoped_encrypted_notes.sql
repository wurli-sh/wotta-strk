-- Keep the inbox boundary explicit on the note row as well as its intent.
-- This prevents cross-network ciphertext from even entering an inbox query.
alter table public.encrypted_notes
  add column if not exists chain_id text;

update public.encrypted_notes note
set chain_id = intent.chain_id
from public.intents intent
where intent.id = note.intent_id
  and note.chain_id is null;

alter table public.encrypted_notes
  alter column chain_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'encrypted_notes_chain_id_check'
  ) then
    alter table public.encrypted_notes
      add constraint encrypted_notes_chain_id_check
      check (chain_id in ('SN_SEPOLIA', 'SN_MAIN'));
  end if;
end $$;

create index if not exists encrypted_notes_recipient_chain_created_at
  on public.encrypted_notes(recipient_profile_id, chain_id, created_at desc);

create or replace function public.enforce_encrypted_note_chain()
returns trigger language plpgsql set search_path = public as $$
declare intent_chain text;
begin
  select chain_id into strict intent_chain from public.intents where id = new.intent_id;
  if new.chain_id <> intent_chain then
    raise exception 'encrypted_note_chain_mismatch';
  end if;
  return new;
end $$;

drop trigger if exists encrypted_notes_chain_guard on public.encrypted_notes;
create trigger encrypted_notes_chain_guard
before insert or update of intent_id, chain_id on public.encrypted_notes
for each row execute function public.enforce_encrypted_note_chain();
