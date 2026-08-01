-- Workshop Hub — true fixed costs
-- Run this in the Supabase SQL editor, after migration_031.
--
-- A maintainable list of the standing monthly overheads (rent, insurance,
-- subscriptions etc) that sit alongside parts/labour/wages when working out
-- what's actually left after every recurring cost of running the business —
-- addable/renameable/deletable from the Profitability tab so the list can
-- grow or change without a schema change every time.
create table if not exists fixed_costs (
  id text primary key default ('fc_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  amount numeric not null default 0,
  sort_order serial
);

alter table fixed_costs enable row level security;
create policy "anon full access" on fixed_costs for all using (true) with check (true);
alter publication supabase_realtime add table fixed_costs;

-- Seeded at £0 — office fills in the real monthly figure for each from the
-- Profitability tab; any of these can be renamed or deleted if it's not
-- quite right (e.g. "Buildings Insurance" split out from general "Insurance").
insert into fixed_costs (name, amount) values
  ('Rent', 0),
  ('Rates', 0),
  ('Electric', 0),
  ('Broadband', 0),
  ('Bookkeeping / Accountants', 0),
  ('Insurance', 0),
  ('Buildings Insurance', 0),
  ('Mobiles', 0),
  ('AI', 0),
  ('Advertising', 0),
  ('Plant and Machinery', 0),
  ('Subscriptions', 0),
  ('Card Machine Costs', 0)
on conflict do nothing;
