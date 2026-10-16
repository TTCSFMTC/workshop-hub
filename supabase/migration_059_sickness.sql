-- Workshop Hub — staff sickness
-- Run this in the Supabase SQL editor.
--
-- One row per absence: who was off sick, first and last day, and a note.
-- Shown on the password-protected Sickness tab for all employees (workshop
-- and office).
create table if not exists sickness (
  id text primary key default ('sick_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  date_from date not null,
  date_to date not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table sickness enable row level security;
create policy "anon full access" on sickness for all using (true) with check (true);
alter publication supabase_realtime add table sickness;
