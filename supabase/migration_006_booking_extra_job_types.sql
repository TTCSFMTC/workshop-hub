-- Workshop Hub — extra job types per booking
-- Run this in the Supabase SQL editor, after migration_005.
--
-- A booking's main job (bookings.job_type_id) stays as-is. This table holds
-- any additional job types added on top (e.g. "Timing Chain Replacement" +
-- "Single Turbo (Recon)" on the same booking) — reusing existing recipes so
-- parts cost/stock deduction stays accurate without a separate ad-hoc list.

create table if not exists booking_job_types (
  booking_id text not null references bookings(id) on delete cascade,
  job_type_id text not null references job_types(id) on delete cascade,
  primary key (booking_id, job_type_id)
);

alter table booking_job_types enable row level security;
create policy "anon full access" on booking_job_types for all using (true) with check (true);
alter publication supabase_realtime add table booking_job_types;
