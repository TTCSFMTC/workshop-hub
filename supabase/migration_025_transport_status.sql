-- Workshop Hub — transport collected/delivered/customer-paid tracking
-- Run this in the Supabase SQL editor, after migration_024.
--
-- transport_confirmed already tracks whether the transport company agreed
-- to the job — these three track what actually happened afterwards, so
-- office can see at a glance what's been charged for and paid.

alter table bookings add column if not exists transport_collected boolean not null default false;
alter table bookings add column if not exists transport_delivered boolean not null default false;
alter table bookings add column if not exists transport_customer_paid boolean not null default false;
