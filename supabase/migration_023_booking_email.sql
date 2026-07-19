-- Workshop Hub — customer email on the booking itself
-- Run this in the Supabase SQL editor, after migration_022.
--
-- Email used to only live on the workshop job card, which office assumed
-- was "already captured on the office side" — it wasn't; nothing captured
-- it anywhere. Adding it to the booking form itself, where office actually
-- enters it, so it's available for the distance approval-report emails and
-- the vehicle drop-off confirmation without a technician re-typing it.

alter table bookings add column if not exists email text not null default '';
