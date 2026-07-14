-- Workshop Hub — price per job type on a booking
-- Run this in the Supabase SQL editor, after migration_014.
--
-- A booking can have a main job type plus extra job types (e.g. Timing Chain
-- Replacement + Single Turbo (Recon)) — this table lets each one be priced
-- separately when booking in, rather than one lump figure with no visible
-- breakdown of how it was made up.
--
-- bookings.job_value stays as the single source of truth everywhere else
-- (profit calc, WhatsApp messages, the Zoho invoice amount) — it's kept in
-- sync as the sum of this table's rows whenever the breakdown is edited, so
-- nothing downstream needed to change.

create table if not exists booking_job_type_prices (
  booking_id text not null references bookings(id) on delete cascade,
  job_type_id text not null references job_types(id) on delete cascade,
  price numeric not null default 0,
  primary key (booking_id, job_type_id)
);

alter table booking_job_type_prices enable row level security;
create policy "anon full access" on booking_job_type_prices for all using (true) with check (true);
alter publication supabase_realtime add table booking_job_type_prices;
