-- Workshop Hub — 4-day post-completion Google review follow-up
-- Run this in the Supabase SQL editor, after migration_012.
--
-- review_followup_done: marks that this booking's review follow-up has been
-- resolved — either a WhatsApp reminder was sent, or Office confirmed the
-- customer had already left a review — so the banner stops showing it
-- either way.
--
-- The review links themselves are per-business (Warrington 4x4 vs Timing
-- Chain Specialists) and fixed in lib/constants.js rather than Settings,
-- since there are exactly two and they don't change. settings.google_review_url
-- (added in migration_012) is no longer used by the app as a result — safe
-- to ignore, not worth a migration just to drop it.

alter table bookings add column if not exists review_followup_done boolean not null default false;
