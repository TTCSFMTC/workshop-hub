-- Workshop Hub — non-productives cost
-- Run this in the Supabase SQL editor, after migration_032.
--
-- A monthly cost representing non-productive time, shown as a deduction
-- against gross profit on the Profitability tab. Editable from Settings.

alter table settings add column if not exists non_productives_cost numeric not null default 5000;
