-- Workshop Hub — two-stage completion (workshop done vs customer collected)
-- Run this in the Supabase SQL editor, after migration_016.
--
-- workshop_completed: the job itself is finished and the car's ready to be
-- picked up — turns the booking orange on the Calendar tab, and is what now
-- gates the "Create Zoho invoice" button (work's done, so it can be billed,
-- even before the customer has actually collected the car).
--
-- The existing "completed" / "completed_at" columns (migration 010/012) are
-- repurposed as the final "customer collected" stage — turns the booking
-- green, and stays the trigger for the 2-day/4-day WhatsApp follow-ups and
-- for counting a booking in the Profitability tab, both of which only make
-- sense once the customer actually has the car back.

alter table bookings add column if not exists workshop_completed boolean not null default false;
alter table bookings add column if not exists workshop_completed_at timestamptz;
