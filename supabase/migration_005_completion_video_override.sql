-- Workshop Hub — completion video override
-- Run this in the Supabase SQL editor, after migration_004.
--
-- Lets the owner (password-gated, same as the Profitability tab) mark a job
-- card's completion video as satisfied without an actual video being logged
-- — for the rare case a real completion video genuinely can't be taken.

alter table job_cards add column if not exists completion_video_overridden boolean not null default false;
