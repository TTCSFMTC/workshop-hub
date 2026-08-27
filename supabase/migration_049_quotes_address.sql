-- Workshop Hub — lets a Quotes-tab quote carry a customer address too
-- (e.g. pulled from an uploaded warranty/insurance schedule PDF).
-- Run this in the Supabase SQL editor, after migration_048.

alter table quotes add column if not exists customer_address text;
