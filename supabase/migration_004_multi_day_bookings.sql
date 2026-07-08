-- Workshop Hub — multi-day bookings
-- Run this in the Supabase SQL editor, after migration_003.
--
-- `bookings.days` is how many days the vehicle is booked in for (default 1,
-- matching today's single-day behaviour for every existing row). The booking
-- then appears on every day of that span on the Office calendar, and pushes
-- a single multi-day block to the public Google Calendar rather than a
-- separate event per day.

alter table bookings add column if not exists days integer not null default 1 check (days >= 1);
