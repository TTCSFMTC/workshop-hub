-- Cancellations tab: a customer cancelling now frees up their slot instead
-- of the booking just being deleted, so office can offer that date to
-- someone on the waiting list. notify_if_earlier_slot is ticked on the
-- booking form for a customer who'd move to an earlier date if one frees
-- up; they stay diarised on their own date until (and unless) they're moved.
alter table bookings add column if not exists notify_if_earlier_slot boolean not null default false;
alter table bookings add column if not exists customer_cancelled boolean not null default false;
alter table bookings add column if not exists customer_cancelled_at timestamptz;
alter table bookings add column if not exists cancellation_filled boolean not null default false;
alter table bookings add column if not exists cancellation_offered_to text references bookings(id) on delete set null;
alter table bookings add column if not exists cancellation_offered_at timestamptz;
