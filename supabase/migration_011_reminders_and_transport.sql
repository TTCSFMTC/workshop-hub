-- Workshop Hub — WhatsApp reminders + transport pricing requests
-- Run this in the Supabase SQL editor, after migration_010.
--
-- reminder_sent: tracks whether the 2-days-before WhatsApp reminder has gone
-- out for this booking, so the Calendar banner doesn't nag about it twice.
--
-- transport_required + settings.transport_contact_*: ticking "Transport
-- required" on a booking fires a WhatsApp price-check to a configured
-- contact (default name "Paul") rather than storing a quote here directly —
-- the price still comes back over WhatsApp and gets typed into
-- transport_cost manually once it's confirmed.

alter table bookings add column if not exists reminder_sent boolean not null default false;
alter table bookings add column if not exists transport_required boolean not null default false;

alter table settings add column if not exists transport_contact_name text not null default 'Paul';
alter table settings add column if not exists transport_contact_phone text not null default '';
