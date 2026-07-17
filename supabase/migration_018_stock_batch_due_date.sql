-- Workshop Hub — due date on stock orders
-- Run this in the Supabase SQL editor, after migration_017.
--
-- Lets an order carry an expected delivery date alongside its qty/price, so
-- the Stock tab can flag one that's overdue (due date passed, still not
-- marked delivered) — the actual "we won't have stock for the jobs we've
-- booked in" early-warning this was originally asked for.

alter table stock_batches add column if not exists due_date date;
