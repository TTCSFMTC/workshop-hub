-- Workshop Hub — vehicle intake confirmation
-- Run this in the Supabase SQL editor, after migration_021.
--
-- A short, signed record captured at the moment a vehicle is dropped off
-- (triggered by the "IN" button in Office mode) — customer details,
-- symptoms, and confirmation of the work needed, with a signature. This is
-- the legal/evidence record for what was agreed at drop-off; the workshop
-- job card itself stays purely internal (diagnosis, checks, findings).

create table if not exists intake_confirmations (
  id text primary key default ('ic_' || replace(gen_random_uuid()::text, '-', '')),
  booking_id text references bookings(id) on delete cascade,
  pre_scan_completed boolean not null default false,
  video_completed boolean not null default false,
  signature text,
  signature_name text not null default '',
  created_at timestamptz not null default now()
);

alter publication supabase_realtime add table intake_confirmations;

alter table intake_confirmations enable row level security;
create policy "anon full access" on intake_confirmations for all using (true) with check (true);
