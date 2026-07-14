-- Workshop Hub — post-completion WhatsApp follow-up
-- Run this in the Supabase SQL editor, after migration_011.
--
-- completed_at: stamped the moment "completed" is ticked on the Calendar tab.
-- The booking's date/days can't be used for this — jobs often finish early
-- or late relative to the scheduled span — so the follow-up banner needs its
-- own timestamp to know when "2 days after completion" actually falls.
--
-- followup_sent: same one-shot pattern as reminder_sent, so the banner
-- doesn't nag about a booking twice.
--
-- google_review_url: the link included in the follow-up message asking for
-- a review, configured once in Settings rather than hardcoded.

alter table bookings add column if not exists completed_at timestamptz;
alter table bookings add column if not exists followup_sent boolean not null default false;

alter table settings add column if not exists google_review_url text not null default '';
