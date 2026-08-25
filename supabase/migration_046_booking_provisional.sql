-- Flags a booking as provisional — a date/slot offered to a customer who
-- hasn't confirmed yet, held via the "Provisional booking" button next to
-- New booking (see components/WorkshopHub.jsx) so the day shows as taken
-- without a full booking's worth of detail.
alter table bookings add column if not exists provisional boolean not null default false;
