-- Wotta Phase 2: X and Google can coexist on one profile. X may also
-- contribute a verified email route without pretending that it came from
-- Google. Soft-revoked rows remain as ownership/audit history.
alter table public.identities drop constraint if exists identities_provider_check;
alter table public.identities
  add constraint identities_provider_check check (provider in ('email', 'google', 'x'));

create index if not exists identities_active_email_lookup
  on public.identities(lower(normalized_identifier), profile_id)
  where provider in ('email', 'google') and revoked_at is null and verified_at is not null;

-- Prevent an email from becoming active on two profiles even when one source
-- is Google and the other is X. Duplicates on the same profile are allowed so
-- unlinking one OAuth source does not remove the other source's route.
create or replace function public.enforce_identity_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.revoked_at is null and new.verified_at is not null and exists (
    select 1 from public.identities existing
    where existing.id <> new.id
      and existing.revoked_at is null
      and existing.verified_at is not null
      and existing.profile_id <> new.profile_id
      and lower(existing.normalized_identifier) = lower(new.normalized_identifier)
      and (
        (new.provider = 'x' and existing.provider = 'x')
        or
        (new.provider in ('email', 'google') and existing.provider in ('email', 'google'))
      )
  ) then
    raise exception using errcode = '23505', message = 'identity_already_linked';
  end if;
  return new;
end $$;

drop trigger if exists identities_enforce_owner on public.identities;
create trigger identities_enforce_owner
before insert or update of profile_id, provider, normalized_identifier, verified_at, revoked_at
on public.identities for each row execute function public.enforce_identity_owner();
