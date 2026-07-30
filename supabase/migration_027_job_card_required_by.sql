-- Workshop Hub — job card "required by" date
-- Run this in the Supabase SQL editor, after migration_026.
--
-- Lets office/workshop flag when a car needs to be ready by, so the
-- workshop floor can sort/prioritise which car to pick up next instead of
-- just working whatever's on top of the physical pile.

alter table job_cards add column if not exists required_by date;
