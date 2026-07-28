-- Workshop Hub — vehicle brands
-- Run this in the Supabase SQL editor, after migration_025.
--
-- As the range of makes taken on grows, Stock & Reorder and Job Types need
-- to be organised by brand rather than one flat list. Each job type gets
-- tagged with a brand; Stock & Reorder then groups a part under every brand
-- whose job type(s) use it. sort_order is a plain serial so brands display
-- in the order they were added, with new ones (via the "Add brand" button)
-- appearing at the end.

create table if not exists brands (
  id text primary key default ('brand_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null unique,
  sort_order serial
);

alter table job_types add column if not exists brand_id text references brands(id) on delete set null;

alter table brands enable row level security;
create policy "anon full access" on brands for all using (true) with check (true);
alter publication supabase_realtime add table brands;

insert into brands (name) values
  ('Landrover'), ('Jaguar'), ('Vauxhall'), ('Ford'), ('Nissan'), ('Peugeot')
on conflict (name) do nothing;
