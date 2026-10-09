-- Money Manager cloud storage. Safe to run more than once.
-- Afterwards add who may use the app:  insert into private.allowed_emails values ('you@example.com');

create schema if not exists private;

create table if not exists private.allowed_emails (email text primary key);

-- Runs with the owner's rights so policies can check the list without exposing it to clients.
create or replace function private.is_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.allowed_emails a where lower(a.email) = lower(auth.jwt() ->> 'email')
  )
$$;
revoke all on function private.is_allowed() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_allowed() to authenticated;

-- One row per browser-storage key of the app, per user. Values are the raw JSON strings.
create table if not exists public.kv (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.kv enable row level security;

drop policy if exists "own rows, allowed users" on public.kv;
create policy "own rows, allowed users" on public.kv
  for all to authenticated
  using (user_id = (select auth.uid()) and (select private.is_allowed()))
  with check (user_id = (select auth.uid()) and (select private.is_allowed()));

revoke all on public.kv from anon;
grant select, insert, update, delete on public.kv to authenticated;
