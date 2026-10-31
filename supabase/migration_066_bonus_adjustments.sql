-- Workshop Hub — manually added jobs for the team bonus (commission)
-- Run this in the Supabase SQL editor.
--
-- Lets a job that isn't picked up automatically (e.g. an engine rebuild) be added
-- to a month's bonus pot from the Profitability tab. One row per addition; it
-- counts towards the chosen bonus type for that month ('YYYY-MM').
create table if not exists bonus_adjustments (
  id text primary key,
  bonus_rate_id text not null references bonus_rates(id) on delete cascade,
  month text not null,
  count integer not null default 1,
  description text not null default '',
  created_at timestamptz not null default now()
);

alter table bonus_adjustments enable row level security;
create policy "anon full access" on bonus_adjustments for all using (true) with check (true);
alter publication supabase_realtime add table bonus_adjustments;
