-- Workshop Hub — weekly parts list "ordered" tick boxes
-- Run this in the Supabase SQL editor.
--
-- One row per part ticked as ordered for a given Monday-Sunday week on the
-- Weekly parts list (Stock & Reorder tab). Untick = row deleted.
create table if not exists weekly_parts_ordered (
  week_start date not null,
  part_id text not null,
  ordered_at timestamptz not null default now(),
  primary key (week_start, part_id)
);

alter table weekly_parts_ordered enable row level security;
create policy "anon full access" on weekly_parts_ordered for all using (true) with check (true);
alter publication supabase_realtime add table weekly_parts_ordered;
