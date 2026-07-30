-- Workshop Hub — standard price per job type
-- Run this in the Supabase SQL editor, after migration_027.
--
-- Some job types are always the same retail price (e.g. a JLR timing chain
-- replacement). Setting it once on the job type itself, rather than
-- re-typing it on every booking, means it can't be mistyped or forgotten —
-- New Booking pre-fills the job value the moment that job type is picked.

alter table job_types add column if not exists standard_price numeric;
