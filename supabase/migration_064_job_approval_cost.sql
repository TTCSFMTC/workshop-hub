-- Workshop Hub — cost of extra work, entered when the approval is sent
-- Run this in the Supabase SQL editor.
--
-- The office enters the price AND the cost when flagging extra work; when the
-- customer approves, the price and cost go onto the booking as one line.
alter table job_approvals add column if not exists cost numeric;
