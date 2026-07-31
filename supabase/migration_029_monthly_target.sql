-- Workshop Hub — monthly sales target
-- Run this in the Supabase SQL editor, after migration_028.
--
-- A single gross-invoice-sales target used on the Profitability tab to
-- track what's already booked in against plan, for the current month and
-- any future months that already have bookings.

alter table settings add column if not exists monthly_target numeric not null default 40000;
