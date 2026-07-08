-- Workshop Hub — Google Calendar sync
-- Run this in the Supabase SQL editor, after schema.sql and migration_002.
--
-- `job_types.color` holds a Google Calendar colorId (e.g. "11" for Tomato/red),
-- set per job type in the Job Types tab, used to colour-code events pushed to
-- the public Google Calendar. `bookings.google_event_id` tracks the matching
-- event on that calendar so it can be updated/deleted later. Neither column
-- ever holds customer/vehicle data — the Google Calendar side only ever sees
-- the job type name and colour, never anything from the `bookings` row itself.

alter table job_types add column if not exists color text;
alter table bookings add column if not exists google_event_id text;
