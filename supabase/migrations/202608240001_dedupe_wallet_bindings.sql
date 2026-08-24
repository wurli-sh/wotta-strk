-- Self-heal duplicate active wallet rows before per-chain uniqueness is enforced.
with ranked as (
  select
    id,
    row_number() over (
      partition by profile_id, chain_id
      order by challenge_verified_at desc nulls last, created_at desc
    ) as rn
  from public.wallet_bindings
  where revoked_at is null
)
update public.wallet_bindings wb
set revoked_at = now()
from ranked r
where wb.id = r.id
  and r.rn > 1;
