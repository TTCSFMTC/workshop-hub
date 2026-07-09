-- Workshop Hub — mark a booking as completed
-- Run this in the Supabase SQL editor, after migration_009.
--
-- Lets Office mark a job as actually finished, independent of its scheduled
-- date/days (some jobs finish early). Profitability only counts bookings
-- that are both priced AND marked complete, so it reflects real finished
-- work rather than anything with a quote typed in.

alter table bookings add column if not exists completed boolean not null default false;
