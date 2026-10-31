-- Public booking: JLR Ingenium requests get their own availability, and any
-- request that doesn't fit normal capacity (full day, short notice, short-staffed,
-- or an Ingenium customer asking for a date outside the available days) is still
-- taken and flagged for office to approve instead of being turned away.
-- The booking form keeps working before this is run — office just won't see the
-- flags on the Booking Requests tab (they're still in the notification email).
alter table booking_requests add column if not exists is_ingenium boolean not null default false;
alter table booking_requests add column if not exists office_flags text;
