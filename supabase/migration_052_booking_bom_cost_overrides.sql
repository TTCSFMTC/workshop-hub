-- Workshop Hub — per-booking BOM unit cost overrides
-- Run this in the Supabase SQL editor, after migration_051.
--
-- A part's cost price is derived from stock batches and shared across every
-- booking that uses it — fine most of the time, but some jobs genuinely paid
-- a different price for a part, or used a part that's never had a cost
-- recorded at all. This lets office correct the unit cost for one line on
-- one booking's parts breakdown (Profitability tab) without touching the
-- part's real cost record. Same shape/pattern as booking_bom_qty_overrides.

create table if not exists booking_bom_cost_overrides (
  booking_id text not null references bookings(id) on delete cascade,
  part_id text not null references parts(id) on delete cascade,
  cost numeric not null default 0,
  primary key (booking_id, part_id)
);

alter table booking_bom_cost_overrides enable row level security;
create policy "anon full access" on booking_bom_cost_overrides for all using (true) with check (true);
alter publication supabase_realtime add table booking_bom_cost_overrides;
