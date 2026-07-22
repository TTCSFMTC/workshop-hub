-- Workshop Hub — auto-generated technical write-up on the job card
-- Run this in the Supabase SQL editor, after migration_023.
--
-- Tracks the most recent AI technical write-up PDF generated from a job
-- card's Technician interpretation + Diagnosis & findings — regenerated
-- automatically as those notes are edited, replacing the previous Drive
-- file rather than accumulating one per edit.

alter table job_cards add column if not exists technical_writeup_url text;
alter table job_cards add column if not exists technical_writeup_drive_file_id text;
alter table job_cards add column if not exists technical_writeup_updated_at timestamptz;
