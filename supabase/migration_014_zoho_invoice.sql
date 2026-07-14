-- Workshop Hub — Zoho Books invoice tracking
-- Run this in the Supabase SQL editor, after migration_013.
--
-- Set once a booking's "Create Zoho invoice" button has been used, so the
-- button can turn into a link to the created invoice instead of being
-- clickable again (Zoho Books has no natural de-dupe of its own here — a
-- second click would just create a second invoice for the same job).

alter table bookings add column if not exists zoho_invoice_id text;
alter table bookings add column if not exists zoho_invoice_number text;
alter table bookings add column if not exists zoho_invoice_url text;
