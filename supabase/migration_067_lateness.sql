-- Workshop Hub — staff lateness
-- Run this in the Supabase SQL editor.
--
-- One row each time someone is late (the same person can be marked more than
-- once on a day). Shown on the Late panel of the Sickness tab.
create table if not exists lateness (
  id text primary key default ('late_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  late_date date not null,
  minutes integer,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table lateness enable row level security;
create policy "anon full access" on lateness for all using (true) with check (true);
alter publication supabase_realtime add table lateness;
