-- Workshop Hub — paid / unpaid leave
-- Run this in the Supabase SQL editor.
--
-- Each holiday entry is either paid holiday (comes off the yearly allowance)
-- or unpaid leave (does not). Existing entries stay paid.
alter table holidays add column if not exists paid boolean not null default true;
