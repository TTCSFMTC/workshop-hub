-- Holds the pending confirmation state between a WhatsApp voice note (Claude
-- parses it into a part + quantity) and the technician's "YES" reply that
-- actually writes it to stock. See app/api/whatsapp/stock/route.js.
create table if not exists whatsapp_stock_requests (
  id text primary key default ('wsr_' || replace(gen_random_uuid()::text, '-', '')),
  from_number text not null,
  transcript text not null,
  part_id text references parts(id),
  part_name text,
  qty numeric,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'unmatched')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table whatsapp_stock_requests enable row level security;
create policy "anon full access" on whatsapp_stock_requests for all using (true) with check (true);
