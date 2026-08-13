-- Workshop Hub — working days per month (for the Forecast tab's daily pace target)
-- Run this in the Supabase SQL editor, after migration_039.

alter table settings add column if not exists working_days_per_month numeric not null default 25;
