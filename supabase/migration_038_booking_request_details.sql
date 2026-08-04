-- Workshop Hub — email, non-runner flag, symptoms, and terms acceptance on
-- public booking requests
-- Run this in the Supabase SQL editor, after migration_037.
--
-- terms_accepted_at is only ever set (never left null) by the server route
-- once it's confirmed termsAccepted was true in the submission — a record
-- of consent, not just a UI checkbox state.

alter table booking_requests add column if not exists email text not null default '';
alter table booking_requests add column if not exists is_non_runner boolean not null default false;
alter table booking_requests add column if not exists symptoms text not null default '';
alter table booking_requests add column if not exists terms_accepted_at timestamptz;
