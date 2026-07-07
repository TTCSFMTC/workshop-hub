-- Workshop Hub — Supabase schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query) once, on a fresh project.

create extension if not exists "pgcrypto";

-- ============================================================
-- Parts inventory
-- ============================================================
create table if not exists parts (
  id text primary key default ('p_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  unit text not null default 'each',
  stock numeric not null default 0,
  cost_price numeric not null default 0
);

-- ============================================================
-- Job types (the recipe header)
-- ============================================================
create table if not exists job_types (
  id text primary key default ('jt_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null
);

-- ============================================================
-- Job type parts (the "recipe" lines — qty of each part per job type)
-- ============================================================
create table if not exists job_type_parts (
  job_type_id text not null references job_types(id) on delete cascade,
  part_id text not null references parts(id) on delete cascade,
  qty numeric not null default 1,
  primary key (job_type_id, part_id)
);

-- ============================================================
-- Settings (single row — workshop config, not in the original five-table
-- list but required for the app to function; added here for completeness)
-- ============================================================
create table if not exists settings (
  id boolean primary key default true check (id),
  workshop_postcode text not null default 'WA1',
  vat_registered boolean not null default false,
  collection_info_url text not null default '',
  transport_companies jsonb not null default '[]'::jsonb
);
insert into settings (id) values (true) on conflict (id) do nothing;

-- ============================================================
-- Bookings
-- ============================================================
create table if not exists bookings (
  id text primary key default ('bk_' || replace(gen_random_uuid()::text, '-', '')),
  business text not null,
  customer_name text not null default '',
  phone text not null default '',
  reg text not null default '',
  symptoms text not null default '',
  job_type_id text references job_types(id) on delete set null,
  date date not null,
  pickup_required boolean not null default false,
  pickup_address text not null default '',
  postcode text not null default '',
  distance_miles numeric,
  job_value numeric not null default 0,
  labour_cost numeric not null default 0,
  transport_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Job cards
-- ============================================================
create table if not exists job_cards (
  id text primary key default ('jc_' || replace(gen_random_uuid()::text, '-', '')),
  booking_id text references bookings(id) on delete set null,
  business text not null default '',
  created_at timestamptz not null default now(),
  date_in date,
  date_out date,
  technician text not null default '',
  make text not null default '',
  model text not null default '',
  reg text not null default '',
  vin text not null default '',
  transmission text not null default '',
  drive text not null default '',
  mileage_in text not null default '',
  mileage_out text not null default '',
  customer_name text not null default '',
  contact text not null default '',
  email text not null default '',
  job_status jsonb not null default '{"estimateSent":false,"customerAuthReceived":false,"partsAwaiting":false,"vehicleOffRoad":false}'::jsonb,
  auth_ref_notes text not null default '',
  symptoms text not null default '',
  technician_interpretation text not null default '',
  pre_diagnostic jsonb not null default '{"preScanCompleted":false,"preScanAttached":false,"faultCodesRecorded":false,"liveDataRecorded":false}'::jsonb,
  diagnosis_findings text not null default '',
  post_diagnostic jsonb not null default '{"postScanCompleted":false,"postScanAttached":false,"noCodesPresent":false}'::jsonb,
  post_checks jsonb not null default '{"roadTestCompleted":false,"warningLightsOff":false,"concernResolved":false}'::jsonb,
  video_log jsonb not null default '[]'::jsonb,
  signature text,
  signature_name text not null default '',
  signature_date text not null default '',
  locked boolean not null default false
);

-- ============================================================
-- Realtime — so a booking made in Office mode appears in Workshop mode
-- instantly, on a different device
-- ============================================================
alter publication supabase_realtime add table parts;
alter publication supabase_realtime add table job_types;
alter publication supabase_realtime add table job_type_parts;
alter publication supabase_realtime add table settings;
alter publication supabase_realtime add table bookings;
alter publication supabase_realtime add table job_cards;

-- ============================================================
-- Row Level Security
--
-- This is an internal single-tenant tool already gated by a shared-password
-- login (see proxy.js) before any request reaches the browser bundle that
-- holds the Supabase anon key. RLS is enabled with a permissive "anon can do
-- anything" policy rather than left disabled, so it fails closed if you ever
-- add another, less-trusted client to this project.
-- ============================================================
alter table parts enable row level security;
alter table job_types enable row level security;
alter table job_type_parts enable row level security;
alter table settings enable row level security;
alter table bookings enable row level security;
alter table job_cards enable row level security;

create policy "anon full access" on parts for all using (true) with check (true);
create policy "anon full access" on job_types for all using (true) with check (true);
create policy "anon full access" on job_type_parts for all using (true) with check (true);
create policy "anon full access" on settings for all using (true) with check (true);
create policy "anon full access" on bookings for all using (true) with check (true);
create policy "anon full access" on job_cards for all using (true) with check (true);

-- ============================================================
-- Seed data — same defaults as the prototype, so the app isn't empty on
-- first run. Safe to delete/edit once real data is entered.
-- ============================================================
insert into parts (id, name, unit, stock, cost_price) values
  ('p_chainkit', 'Timing Chain Kit (Ingenium)', 'kit', 6, 180),
  ('p_oilfilter', 'Oil Filter', 'each', 14, 8),
  ('p_oil', 'Engine Oil 0W-20', 'litre', 60, 6),
  ('p_gasket', 'Rocker Cover Gasket', 'each', 8, 15),
  ('p_vvt', 'VVT Pulley', 'each', 5, 45),
  ('p_airfilter', 'Air Filter', 'each', 10, 9),
  ('p_clutchkit', 'Clutch Kit', 'kit', 3, 160),
  ('p_flywheel', 'Dual Mass Flywheel', 'each', 2, 140)
on conflict (id) do nothing;

insert into job_types (id, name) values
  ('jt_timing', 'Timing Chain Replacement'),
  ('jt_service', 'General Service'),
  ('jt_clutch', 'Clutch Replacement')
on conflict (id) do nothing;

insert into job_type_parts (job_type_id, part_id, qty) values
  ('jt_timing', 'p_chainkit', 1),
  ('jt_timing', 'p_oilfilter', 1),
  ('jt_timing', 'p_oil', 5.7),
  ('jt_timing', 'p_gasket', 1),
  ('jt_timing', 'p_vvt', 1),
  ('jt_service', 'p_oilfilter', 1),
  ('jt_service', 'p_oil', 5.5),
  ('jt_service', 'p_airfilter', 1),
  ('jt_clutch', 'p_clutchkit', 1),
  ('jt_clutch', 'p_flywheel', 1)
on conflict (job_type_id, part_id) do nothing;

update settings set
  workshop_postcode = 'WA1',
  transport_companies = '[{"name":"Transport company 1","email":""},{"name":"Transport company 2","email":""}]'::jsonb
where id = true
  and workshop_postcode = 'WA1'
  and transport_companies = '[]'::jsonb;
