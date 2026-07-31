-- Workshop Hub — staff wages & bonus tracking
-- Run this in the Supabase SQL editor, after migration_030.
--
-- Lets office track each technician's monthly outlay (basic + weekend
-- days + per-job bonuses) against that month's gross profit, to see how
-- efficient each person is and what wages cost as a share of margin.

-- Configurable bonus schedule (£ per job) — e.g. Timing Chain £100, Timing
-- Belt £50, Turbo £75, Piston Cooling Jet £50 — extendable via the UI.
create table if not exists bonus_rates (
  id text primary key default ('br_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  rate numeric not null default 0,
  sort_order serial
);

-- One row per person per month. bonus_counts is a JSON map of
-- { [bonus_rate_id]: quantity } so it can grow with the bonus schedule
-- above without a schema change every time a new bonus type is added.
create table if not exists staff_wages (
  id text primary key default ('sw_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  month text not null,
  basic numeric not null default 2063,
  weekend_full_days numeric not null default 0,
  weekend_half_days numeric not null default 0,
  bonus_counts jsonb not null default '{}'::jsonb,
  unique (name, month)
);

alter table bonus_rates enable row level security;
alter table staff_wages enable row level security;
create policy "anon full access" on bonus_rates for all using (true) with check (true);
create policy "anon full access" on staff_wages for all using (true) with check (true);
alter publication supabase_realtime add table bonus_rates;
alter publication supabase_realtime add table staff_wages;

insert into bonus_rates (name, rate) values
  ('Timing Chain', 100),
  ('Timing Belt', 50),
  ('Turbo', 75),
  ('Piston Cooling Jet', 50)
on conflict do nothing;
