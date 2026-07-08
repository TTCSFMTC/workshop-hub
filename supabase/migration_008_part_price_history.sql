-- Workshop Hub — part numbers + price history
-- Run this in the Supabase SQL editor, after migration_007.
--
-- part_number: the supplier/manufacturer part number (e.g. LR073816), shown
-- next to the part in Stock so it can be quoted/searched against suppliers.
--
-- part_price_history: an append-only ledger of what was paid for a part over
-- time. Recording a new price here also becomes the part's current cost
-- price — the old price isn't lost, it just becomes history, so the
-- Stock tab can show trend analysis instead of only the latest figure.

alter table parts add column if not exists part_number text;

create table if not exists part_price_history (
  id text primary key,
  part_id text not null references parts(id) on delete cascade,
  price numeric not null,
  qty numeric,
  supplier text,
  recorded_at timestamptz not null default now()
);

alter table part_price_history enable row level security;
create policy "anon full access" on part_price_history for all using (true) with check (true);
alter publication supabase_realtime add table part_price_history;
