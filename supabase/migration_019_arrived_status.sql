-- Workshop Hub — "Arrived" stage (traffic light system)
-- Run this in the Supabase SQL editor, after migration_018.
--
-- Adds a third stage before "workshop completed" / "collected": the vehicle
-- physically arriving at the unit. Combined with the existing
-- workshop_completed and completed columns, this gives the three-stage
-- traffic light shown under each booking — red (arrived), orange (workshop
-- completed), green (collected).

alter table bookings add column if not exists arrived boolean not null default false;
alter table bookings add column if not exists arrived_at timestamptz;
