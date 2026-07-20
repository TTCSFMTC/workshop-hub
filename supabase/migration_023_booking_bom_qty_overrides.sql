-- Workshop Hub — per-booking BOM quantity overrides
-- Run this in the Supabase SQL editor, after migration_022.
--
-- A job type's bill of materials (job_type_parts) is a fixed template quantity
-- shared across every booking that uses it — fine for most jobs, but some
-- parts genuinely vary per vehicle (e.g. "Replace Followers": some cars take
-- 3, some take 6). This table lets a booking override the quantity for a
-- specific part without touching the job type's own default for future
-- bookings. Same shape/pattern as booking_extra_parts.

create table if not exists booking_bom_qty_overrides (
  booking_id text not null references bookings(id) on delete cascade,
  part_id text not null references parts(id) on delete cascade,
  qty numeric not null default 1,
  primary key (booking_id, part_id)
);

alter table booking_bom_qty_overrides enable row level security;
create policy "anon full access" on booking_bom_qty_overrides for all using (true) with check (true);
alter publication supabase_realtime add table booking_bom_qty_overrides;
