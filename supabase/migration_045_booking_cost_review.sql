-- Lets the Profitability tab's monthly table override the auto-computed
-- parts cost per booking (labour_cost/transport_cost already had this),
-- and flags a row as manually checked once someone's confirmed the three
-- cost figures are right — see ProfitabilityTab in components/WorkshopHub.jsx.
alter table bookings add column if not exists parts_cost_override numeric;
alter table bookings add column if not exists costs_reviewed boolean not null default false;
