# Reliability (pilot, Standard finality)

These targets are **RECOMMENDATION**. They are not a compile gate and are not live SLOs until retained mainnet traffic exists.

## Alerts

- Burn → Circle Iris complete: alert if p95 > 30 minutes (Standard / `minFinalityThreshold=2000`).
- Attestation ready → `onchain_state=funded`: alert if p95 > 15 minutes while the relayer is funded.
- Stalled work: `GET /v1/health` `oldestQueuedAgeSec` > 900.

Quote → burn abandon is measured only; it does not fail `check:phase4`.

## Public health

`/v1/health` exposes queue depth, oldest queued age, failed job count, and optional `strkAlert` (`true` / `false` / `null`). It must not expose addresses, wei, or conversion funnels.

## Measuring conversion from `intent_events`

Service-role SQL (not served on `/v1/health`):

```sql
-- quote to burn
select
  percentile_cont(0.95) within group (order by extract(epoch from (b.created_at - q.created_at))) as p95_quote_to_burn_sec
from intent_events q
join intent_events b
  on b.intent_id = q.intent_id and b.to_state = 'source_submitted'
where q.to_state = 'quoted';

-- burn to attestation
select
  percentile_cont(0.95) within group (order by extract(epoch from (a.created_at - b.created_at))) as p95_burn_to_attestation_sec
from intent_events b
join intent_events a
  on a.intent_id = b.intent_id and a.to_state = 'attestation_ready'
where b.to_state = 'source_submitted';

-- attestation to funded
select
  percentile_cont(0.95) within group (order by extract(epoch from (f.created_at - a.created_at))) as p95_attestation_to_funded_sec
from intent_events a
join intent_events f
  on f.intent_id = a.intent_id and f.to_state = 'funded'
where a.to_state = 'attestation_ready';

-- claims, failures, recovered settles
select to_state, count(*) from intent_events
where to_state in ('claimed', 'failed_recoverable', 'failed_terminal')
group by 1;

select count(*) as recovered_settles
from intent_events
where evidence ? 'recovered';
```
