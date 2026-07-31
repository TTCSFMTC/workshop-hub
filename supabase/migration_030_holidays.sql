-- Workshop Hub — staff holidays
-- Run this in the Supabase SQL editor, after migration_029.
--
-- Lets office record when a technician's off, and marks those days on the
-- diary with a red border so bookings aren't made on a day short-staffed
-- without realising it.

create table if not exists holidays (
  id text primary key default ('hol_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  date_from date not null,
  date_to date not null
);

alter table holidays enable row level security;
create policy "anon full access" on holidays for all using (true) with check (true);
alter publication supabase_realtime add table holidays;
