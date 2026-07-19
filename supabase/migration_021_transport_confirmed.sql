-- Workshop Hub — transport confirmation status
-- Run this in the Supabase SQL editor, after migration_020.
--
-- Records whether the transport contact (e.g. Paul) confirmed or declined
-- a collection job after being WhatsApp'd for a price — null until he's
-- replied, true once confirmed, false if declined.

alter table bookings add column if not exists transport_confirmed boolean;
