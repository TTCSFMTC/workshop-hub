-- Workshop Hub — Chain & Belt Quote history
-- Run this in the Supabase SQL editor.
--
-- One row per registration checked on the Chain & Belt Quote tab: what was
-- quoted (inc VAT) and whether the WhatsApp quote was sent. Shown as a
-- one-line-per-check history under the tab.
create table if not exists chain_belt_checks (
  id text primary key,
  reg text not null,
  vehicle text not null default '',
  job text not null default '',
  price numeric,
  whatsapp_sent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table chain_belt_checks enable row level security;
create policy "anon full access" on chain_belt_checks for all using (true) with check (true);
alter publication supabase_realtime add table chain_belt_checks;
