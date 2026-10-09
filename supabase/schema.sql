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
revoke all on private.allowed_emails from anon, authenticated;

-- Every upload states the version it was based on; the app only writes where it still matches, so a
-- device holding an old copy can't overwrite newer changes from another device.
alter table public.kv add column if not exists version bigint not null default 1;

-- Backups: before a row is changed or deleted, its previous value is kept, one snapshot per key per day
-- (the state at the start of that day), for 14 days. Restore by copying a snapshot back into public.kv.
create table if not exists private.kv_history (
  user_id uuid not null,
  key text not null,
  day date not null,
  value text not null,
  version bigint not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, key, day)
);
revoke all on private.kv_history from anon, authenticated;

create or replace function private.keep_kv_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.kv_history (user_id, key, day, value, version)
  values (old.user_id, old.key, current_date, old.value, old.version)
  on conflict (user_id, key, day) do nothing;
  delete from private.kv_history where saved_at < now() - interval '14 days';
  return null;
end
$$;

drop trigger if exists keep_kv_history on public.kv;
create trigger keep_kv_history after update or delete on public.kv
  for each row execute function private.keep_kv_history();

-- Pinged daily by the app's cron (/api/keepalive) so Supabase doesn't pause the project for inactivity.
create or replace function public.ping() returns integer language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon;
