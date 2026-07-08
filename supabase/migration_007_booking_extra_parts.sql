-- Workshop Hub — extra individual parts on a booking
-- Run this in the Supabase SQL editor, after migration_006.
--
-- Sits alongside "extra job types" (migration_006) for one-off single-part
-- additions that don't warrant a whole job type recipe (e.g. one extra
-- gasket), picked straight from the Stock parts catalogue with a quantity.

create table if not exists booking_extra_parts (
  booking_id text not null references bookings(id) on delete cascade,
  part_id text not null references parts(id) on delete cascade,
  qty numeric not null default 1,
  primary key (booking_id, part_id)
);

alter table booking_extra_parts enable row level security;
create policy "anon full access" on booking_extra_parts for all using (true) with check (true);
alter publication supabase_realtime add table booking_extra_parts;
