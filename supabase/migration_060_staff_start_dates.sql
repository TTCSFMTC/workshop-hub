-- Workshop Hub — staff start dates
-- Run this in the Supabase SQL editor.
--
-- When each employee started, so holiday accrues only for full months worked
-- from that date. Edited on the Holidays tab (Holiday allowance box).
create table if not exists staff_start_dates (
  name text primary key,
  start_date date not null
);

alter table staff_start_dates enable row level security;
create policy "anon full access" on staff_start_dates for all using (true) with check (true);
alter publication supabase_realtime add table staff_start_dates;
