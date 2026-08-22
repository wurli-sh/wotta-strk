-- Durable destination submission makes relayer retries idempotent after an RPC timeout.
alter table public.relayer_jobs add column if not exists destination_tx_hash text;
create index if not exists relayer_jobs_status_created on public.relayer_jobs(status, created_at);
