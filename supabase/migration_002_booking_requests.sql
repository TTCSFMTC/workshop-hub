-- Workshop Hub — public customer booking requests
-- Run this in the Supabase SQL editor, after the original schema.sql.
--
-- This is a SEPARATE table from `bookings` on purpose: it holds unauthenticated,
-- public-internet submissions (name, address, phone, vehicle reg), so it gets a
-- stricter security model than the rest of the app. The public /book page never
-- talks to Supabase directly — it goes through Next.js server routes, which use
-- the service_role key. Anon (the key embedded in the browser bundle) is only
-- ever allowed to INSERT here, never SELECT, so a customer's own submission (or
-- anyone else's) can never be read back out directly via the public API.

create table if not exists booking_requests (
  id text primary key default ('req_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  address text not null default '',
  phone text not null default '',
  reg text not null default '',
  -- Which of the two businesses this request is for — the public /book page
  -- serves both from the same form, so it has to be captured explicitly
  -- rather than inferred. Same two values as bookings.business.
  business text not null default 'Warrington 4x4' check (business in ('Warrington 4x4', 'Timing Chain Specialists')),
  requirements jsonb not null default '[]'::jsonb,
  date date not null,
  status text not null default 'pending' check (status in ('pending', 'converted', 'declined')),
  created_at timestamptz not null default now()
);

alter table booking_requests enable row level security;

-- Public can create a request, but cannot read any back (not even their own).
create policy "anon can submit" on booking_requests for insert with check (true);

-- No SELECT/UPDATE/DELETE policy for anon at all — those only happen through
-- server routes using the service_role key, which bypasses RLS entirely.

-- Lets the public calendar show "2/3 booked" without ever exposing a row.
create or replace function public_booking_counts(from_date date, to_date date)
returns table (booking_date date, request_count bigint)
language sql
security definer
set search_path = public
as $$
  select date as booking_date, count(*) as request_count
  from booking_requests
  where date between from_date and to_date
    and status != 'declined'
  group by date;
$$;

grant execute on function public_booking_counts(date, date) to anon;
