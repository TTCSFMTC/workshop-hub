-- Itemised ad-hoc costs added to a booking as they come in (an extra part
-- bought outside the standard recipe, a call-out, anything not already
-- captured by Parts/Labour/Transport) — see the "Additional costs" list on
-- the booking card and the Profitability breakdown row.
create table if not exists booking_extra_costs (
  id text primary key default ('bec_' || replace(gen_random_uuid()::text, '-', '')),
  booking_id text not null references bookings(id) on delete cascade,
  description text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

alter table booking_extra_costs enable row level security;
create policy "anon full access" on booking_extra_costs for all using (true) with check (true);
