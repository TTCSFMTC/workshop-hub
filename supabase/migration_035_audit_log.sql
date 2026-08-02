-- Workshop Hub — audit log for stock/order corrections and deletions
-- Run this in the Supabase SQL editor, after migration_034.
--
-- Every stock quantity correction, order amendment, or cancelled order gets
-- logged here along with the reason given for it (required, not optional) —
-- so if a figure looks wrong later, there's a record of who changed what and
-- why, rather than a silent edit.

create table if not exists audit_log (
  id text primary key default ('al_' || replace(gen_random_uuid()::text, '-', '')),
  summary text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table audit_log enable row level security;
create policy "anon full access" on audit_log for all using (true) with check (true);
alter publication supabase_realtime add table audit_log;
