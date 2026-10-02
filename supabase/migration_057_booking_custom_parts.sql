-- One-off "Other" parts typed straight onto a booking (a part that isn't in
-- the Stock catalogue): what it is, what it cost us, and what we're charging
-- for it. Cost feeds the booking's parts cost; retail feeds its job value and
-- becomes its own line on the Zoho invoice. Never touches stock levels.
create table if not exists booking_custom_parts (
  id text primary key default ('cp_' || replace(gen_random_uuid()::text, '-', '')),
  booking_id text not null references bookings(id) on delete cascade,
  description text not null,
  cost numeric not null default 0,
  retail numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table booking_custom_parts enable row level security;
create policy "anon full access" on booking_custom_parts for all using (true) with check (true);
alter publication supabase_realtime add table booking_custom_parts;
