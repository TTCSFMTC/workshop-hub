-- Flags a booking as a customer no-show, set by the "Customer no-show"
-- button on the booking (see components/WorkshopHub.jsx) — same shape as
-- the existing arrived/arrived_at pair.
alter table bookings add column if not exists no_show boolean not null default false;
alter table bookings add column if not exists no_show_at timestamptz;
