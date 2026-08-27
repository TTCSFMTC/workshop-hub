-- Workshop Hub — lets a Quotes-tab quote be generated from an uploaded PDF
-- instead of only pasted script text. Run this in the Supabase SQL editor,
-- after migration_047.

alter table quotes alter column source_script drop not null;
alter table quotes add column if not exists source_pdf_url text;
alter table quotes add column if not exists source_pdf_drive_file_id text;
