-- Workshop Hub — stock ordering with FIFO batch pricing
-- Run this in the Supabase SQL editor, after migration_015.
--
-- Replaces the old "receive stock at whatever the current cost price is"
-- model with proper batches: place an order at a price (status 'ordered',
-- not counted as physical stock yet), then mark it delivered once it
-- physically arrives at the unit (status 'delivered', now counts).
--
-- parts.stock and parts.cost_price stay in the schema (so nothing else that
-- references parts needs to change) but become derived, not stored, going
-- forward — the app computes both from delivered batches: stock is the sum
-- of qty_remaining, cost price is whichever delivered batch is oldest and
-- still has qty_remaining > 0 (FIFO), so a cheaper existing batch keeps
-- being the reported cost until it's actually used up.

create table if not exists stock_batches (
  id text primary key default ('sb_' || replace(gen_random_uuid()::text, '-', '')),
  part_id text not null references parts(id) on delete cascade,
  qty_ordered numeric not null,
  qty_remaining numeric not null,
  price numeric not null,
  supplier text,
  status text not null default 'ordered' check (status in ('ordered', 'delivered')),
  ordered_at timestamptz not null default now(),
  delivered_at timestamptz
);

alter table stock_batches enable row level security;
create policy "anon full access" on stock_batches for all using (true) with check (true);
alter publication supabase_realtime add table stock_batches;

-- One-off: carries existing physical stock over into the new system as an
-- opening batch, using each part's current stock/cost_price, so nothing is
-- lost and nothing needs re-entering by hand. Safe to run once; re-running
-- won't duplicate rows for a part that already has a batch.
insert into stock_batches (part_id, qty_ordered, qty_remaining, price, status, delivered_at)
select id, stock, stock, cost_price, 'delivered', now()
from parts
where stock > 0
  and not exists (select 1 from stock_batches where stock_batches.part_id = parts.id);
