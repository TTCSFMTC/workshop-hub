-- Workshop Hub — which job types show on the public booking form
-- Run this in the Supabase SQL editor, after migration_035.
--
-- The public /book page previously listed every job type; this restricts it
-- to a curated set customers can genuinely self-serve on, toggleable from
-- the Job Types tab going forward without needing another migration.

alter table job_types add column if not exists public_bookable boolean not null default false;

update job_types set public_bookable = true where name in (
  'Ford Wet Belt',
  'Ford EcoBlue Wet Belt (Mondeo)',
  'Nissan DIGT Timing Chain Replacement',
  'Petrol Ingenium Timing Chain Kit',
  'Peugeot / Citroen PT Wetbelt',
  'Timing Chain Replacement',
  'Vauxhall 1.2 VVT Petrol Chain Replacement'
);
