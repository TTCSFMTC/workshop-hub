-- Workshop Hub — link bonus types to the job types that earn them
-- Run this in the Supabase SQL editor, after migration_040.
--
-- Lets the Staff Wages bonus pot be computed automatically from actually
-- completed + invoiced bookings, instead of Chris typing a count per
-- technician per bonus type by hand every month.

alter table bonus_rates add column if not exists job_type_ids jsonb not null default '[]'::jsonb;
