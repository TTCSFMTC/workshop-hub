-- Workshop Hub — vehicle model on bookings
-- Run this in the Supabase SQL editor, after migration_008.
--
-- Lets a booking record which vehicle model it's for. First use: picking the
-- correct thermostat housing (A or B) automatically instead of staff having
-- to remember which model uses which part number.

alter table bookings add column if not exists vehicle_model text;
