-- Workshop Hub — monthly Profit & Loss snapshots
-- Run this in the Supabase SQL editor, after migration_053.
--
-- Freezing a month saves its whole computed Profit & Loss picture — revenue,
-- VAT, parts/labour/transport/extra costs, gross profit, staff wages (with
-- the bonus pot breakdown), fixed costs, and the resulting net profit — as
-- one JSON snapshot, so it stays exactly as it was even if the underlying
-- bookings, wages or fixed costs get edited later. One row per month.

create table if not exists pl_snapshots (
  id text primary key default ('pls_' || replace(gen_random_uuid()::text, '-', '')),
  month text not null unique,
  snapshot jsonb not null,
  frozen_at timestamptz not null default now()
);

alter table pl_snapshots enable row level security;
create policy "anon full access" on pl_snapshots for all using (true) with check (true);
alter publication supabase_realtime add table pl_snapshots;
