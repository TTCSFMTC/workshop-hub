-- Workshop Hub — distance customer approval reports
-- Run this in the Supabase SQL editor, after migration_019.
--
-- A technician flags extra work found during diagnosis (raw notes, no
-- price). Office reviews it, sets the price and whether it can be done
-- while the vehicle's already in, then sends an AI-written explanation to
-- the customer by email for a remote approve/decline with signature —
-- evidence for a customer who isn't physically at the workshop to sign
-- the tablet.

create table if not exists job_approvals (
  id text primary key default ('ja_' || replace(gen_random_uuid()::text, '-', '')),
  job_card_id text references job_cards(id) on delete cascade,
  booking_id text references bookings(id) on delete set null,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  description text not null default '',
  ai_writeup text,
  price numeric,
  in_stock boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  customer_signature text,
  customer_signature_name text
);

alter publication supabase_realtime add table job_approvals;

alter table job_approvals enable row level security;
create policy "anon full access" on job_approvals for all using (true) with check (true);
