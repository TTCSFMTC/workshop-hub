-- Workshop Hub — supplier invoice scanning + Zoho Bills
-- Run this in the Supabase SQL editor, after migration_038.
--
-- Two new internal-only tables (same permissive anon-key RLS as every other
-- Office-mode table — the whole app is already gated by the site password
-- before any client code runs, unlike the public-facing booking_requests
-- table). `suppliers` is a real entity replacing the free-text `supplier`
-- string already used on stock_batches/part_price_history for this new
-- feature specifically — it doesn't touch or migrate that existing data.

create table suppliers (
  id text primary key default ('sup_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null unique,
  contact_email text,
  contact_name text,
  created_at timestamptz not null default now()
);

alter table suppliers enable row level security;
create policy "anon full access" on suppliers for all using (true) with check (true);
alter publication supabase_realtime add table suppliers;

-- One row per uploaded/scanned invoice PDF. stock_batch_id links it to the
-- specific order it's paying for (nullable — not every purchase is a
-- stock order, e.g. tools or fuel), so "delivered batch with no linked
-- invoice" becomes the definition of a missing invoice at month end.
create table supplier_invoices (
  id text primary key default ('sinv_' || replace(gen_random_uuid()::text, '-', '')),
  supplier_id text references suppliers(id),
  stock_batch_id text references stock_batches(id),
  business text not null default 'Warrington 4x4' check (business in ('Warrington 4x4', 'Timing Chain Specialists')),
  pdf_url text not null,
  pdf_drive_file_id text,
  vendor_name_raw text,
  invoice_number text,
  invoice_date date,
  due_date date,
  subtotal numeric,
  tax numeric,
  total numeric not null default 0,
  line_items jsonb not null default '[]'::jsonb,
  status text not null default 'needs_review' check (status in ('needs_review', 'confirmed', 'posted')),
  zoho_bill_id text,
  zoho_bill_number text,
  zoho_bill_url text,
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table supplier_invoices enable row level security;
create policy "anon full access" on supplier_invoices for all using (true) with check (true);
alter publication supabase_realtime add table supplier_invoices;
