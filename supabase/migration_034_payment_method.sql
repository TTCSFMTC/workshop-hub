-- Workshop Hub — payment method on bookings
-- Run this in the Supabase SQL editor, after migration_033.
--
-- Records which payment method (cash / debit card / bank transfer) was
-- agreed with the customer, so anyone else who takes payment can see at a
-- glance what was actually agreed instead of guessing or asking again.

alter table bookings add column if not exists payment_method text;
