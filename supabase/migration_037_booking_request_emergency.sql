-- Workshop Hub — emergency and "other" booking requests
-- Run this in the Supabase SQL editor, after migration_036.
--
-- Lets the public booking form offer two extra paths alongside the normal
-- curated job-type list: an Emergency Appointment (two preferred dates,
-- skips the usual notice/capacity rules since it's urgent by definition)
-- and a free-text "Other" request for anything not on the standard list.

alter table booking_requests add column if not exists is_emergency boolean not null default false;
alter table booking_requests add column if not exists second_date date;
alter table booking_requests add column if not exists other_details text;
