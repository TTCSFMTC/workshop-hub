-- Workshop Hub — Quotes tab: paste an AI-drafted script → review → post to
-- Zoho as an Estimate.
-- Run this in the Supabase SQL editor, after migration_046.
--
-- Same permissive anon-key RLS as every other Office-mode table (the app is
-- already gated by the site password before any client code runs) and the
-- same realtime publication so a quote generated in Office mode shows up
-- everywhere else instantly, same as Supplier Invoices (migration_039).

create table quotes (
  id text primary key default ('quo_' || replace(gen_random_uuid()::text, '-', '')),
  business text not null default 'Warrington 4x4' check (business in ('Warrington 4x4', 'Timing Chain Specialists')),
  customer_name text,
  customer_email text,
  customer_phone text,
  vehicle_description text,
  source_script text not null, -- the raw pasted Claude/ChatGPT text, kept for reference
  line_items jsonb not null default '[]'::jsonb, -- [{ type: 'part'|'labour', description, quantity, unit_price, amount }]
  subtotal numeric not null default 0,
  vat_rate numeric not null default 20,
  vat numeric not null default 0,
  total numeric not null default 0,
  notes text,
  status text not null default 'needs_review' check (status in ('needs_review', 'confirmed', 'posted')),
  zoho_estimate_id text,
  zoho_estimate_number text,
  zoho_estimate_url text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

alter table quotes enable row level security;
create policy "anon full access" on quotes for all using (true) with check (true);
alter publication supabase_realtime add table quotes;
