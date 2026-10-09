-- Readable tables of your finance data: accounts, people, categories, transactions (with split shares and
-- statement sources), imported statements, their lines, and learned rules.
--
-- The app saves to public.kv; a trigger rebuilds these tables from it on every save, so they always match
-- the app exactly. They are a read-only copy: change data in the app, since edits made here get overwritten.
-- If refreshing them ever fails, the save itself still succeeds (a warning is logged instead).
-- Run after schema.sql. Safe to run more than once. Amounts are paise; each has a rupee column beside it.

create table if not exists public.accounts (
  user_id uuid not null,
  id text not null,
  name text not null,
  type text not null,
  opening_balance_paise bigint not null default 0,
  opening_balance numeric(16, 2) generated always as (opening_balance_paise / 100.0) stored,
  opened_on date,
  created_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.people (
  user_id uuid not null,
  id text not null,
  name text not null,
  created_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.categories (
  user_id uuid not null,
  id text not null,
  name text not null,
  kind text not null,
  color text,
  icon text,
  built_in boolean not null,
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id uuid not null,
  id text not null,
  type text not null,
  date date not null,
  amount_paise bigint not null,
  amount numeric(16, 2) generated always as (amount_paise / 100.0) stored,
  account_id text,
  from_account_id text,
  to_account_id text,
  holding_id text,
  person_id text,
  category_id text,
  sold_value_paise bigint,
  predates_records boolean,
  description text,
  note text,
  from_statement boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  primary key (user_id, id)
);
create index if not exists transactions_user_date on public.transactions (user_id, date desc);

create table if not exists public.transaction_shares (
  user_id uuid not null,
  transaction_id text not null,
  position int not null,
  person_id text not null,
  amount_paise bigint not null,
  amount numeric(16, 2) generated always as (amount_paise / 100.0) stored,
  primary key (user_id, transaction_id, position)
);

create table if not exists public.transaction_sources (
  user_id uuid not null,
  transaction_id text not null,
  position int not null,
  import_id text,
  statement_line_id text,
  filename text,
  line int,
  narration text,
  role text,
  primary key (user_id, transaction_id, position)
);

create table if not exists public.statement_imports (
  user_id uuid not null,
  id text not null,
  filename text,
  account_id text,
  bank text,
  account_mask text,
  period_start date,
  period_end date,
  status text,
  opening_balance_paise bigint,
  closing_balance_paise bigint,
  card_statement boolean,
  ai_used boolean,
  uploaded_at timestamptz,
  imported_at timestamptz,
  primary key (user_id, id)
);

create table if not exists public.statement_lines (
  user_id uuid not null,
  id text not null,
  import_id text not null,
  line_no int,
  page int,
  transaction_date date,
  value_date date,
  description text,
  direction text,
  amount_paise bigint,
  amount numeric(16, 2) generated always as (amount_paise / 100.0) stored,
  balance_after_paise bigint,
  reference text,
  status text,
  transaction_id text,
  primary key (user_id, id)
);
create index if not exists statement_lines_user_import on public.statement_lines (user_id, import_id, line_no);

create table if not exists public.rules (
  user_id uuid not null,
  id text not null,
  match_key text,
  direction text,
  event_type text,
  category text,
  person text,
  counter_account_id text,
  holding text,
  always boolean,
  confirmations int,
  contradictions int,
  updated_at timestamptz,
  primary key (user_id, id)
);

-- Read-only for the signed-in, allowed owner; only the trigger below writes.
do $$
declare t text;
begin
  foreach t in array array['accounts', 'people', 'categories', 'transactions', 'transaction_shares',
                           'transaction_sources', 'statement_imports', 'statement_lines', 'rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner reads" on public.%I', t);
    execute format('create policy "owner reads" on public.%I for select to authenticated
                    using (user_id = (select auth.uid()) and (select private.is_allowed()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('comment on table public.%I is %L', t,
      'Read-only copy, refreshed from public.kv on every save in the app. Edit in the app: changes made here are overwritten.');
  end loop;
end
$$;

-- Built-in categories live in the app's code (lib/domain/categories.ts); custom ones are saved by the app.
create or replace function private.mirror_categories(p_user uuid, p_custom jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.categories where user_id = p_user;
  insert into public.categories (user_id, id, name, kind, color, icon, built_in)
  select p_user, v.id, v.name, v.kind, v.color, v.icon, true
  from (values
    ('food', 'Food', 'expense', '#f97316', 'food'),
    ('shopping', 'Shopping', 'expense', '#ec4899', 'shopping'),
    ('transport', 'Transport', 'expense', '#0ea5e9', 'transport'),
    ('petrol', 'Petrol', 'expense', '#dc2626', 'transport'),
    ('rent', 'Rent', 'expense', '#8b5cf6', 'rent'),
    ('bills', 'Bills', 'expense', '#eab308', 'bills'),
    ('entertainment', 'Entertainment', 'expense', '#14b8a6', 'entertainment'),
    ('health', 'Health', 'expense', '#22c55e', 'health'),
    ('travel', 'Travel', 'expense', '#6366f1', 'travel'),
    ('subscriptions', 'Subscriptions', 'expense', '#06b6d4', 'custom'),
    ('emi', 'EMI', 'expense', '#0891b2', 'loan'),
    ('grocery', 'Grocery', 'expense', '#65a30d', 'food'),
    ('smoking', 'Smoking', 'expense', '#78716c', 'custom'),
    ('alcohol', 'Alcohol', 'expense', '#b91c1c', 'custom'),
    ('maintenance', 'Maintenance', 'expense', '#0f766e', 'rent'),
    ('jugaad', 'Jugaad', 'expense', '#a16207', 'custom'),
    ('other', 'Other', 'expense', '#94a3b8', 'other'),
    ('salary', 'Salary', 'income', '#10b981', 'income'),
    ('business', 'Business', 'income', '#0ea5e9', 'income'),
    ('interest', 'Interest', 'income', '#8b5cf6', 'income'),
    ('refund', 'Refund', 'income', '#f59e0b', 'income'),
    ('reimbursement', 'Reimbursement', 'income', '#64748b', 'income'),
    ('gift', 'Gift', 'income', '#ec4899', 'income'),
    ('other-income', 'Other income', 'income', '#94a3b8', 'income')
  ) as v (id, name, kind, color, icon);
  insert into public.categories (user_id, id, name, kind, color, icon, built_in)
  select p_user, c ->> 'id', c ->> 'name', coalesce(c ->> 'kind', 'expense'), c ->> 'color', c ->> 'icon', false
  from jsonb_array_elements(coalesce(p_custom, '[]'::jsonb)) c
  on conflict (user_id, id) do update
    set name = excluded.name, kind = excluded.kind, color = excluded.color, icon = excluded.icon, built_in = false;
end
$$;

-- Rebuilds this user's tables for one saved key. p_value is null when the key was deleted.
create or replace function private.mirror_kv(p_user uuid, p_key text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := case when p_value is null then null else p_value::jsonb end;
begin
  if p_key = 'money-manager:v1:book' then
    delete from public.transaction_sources where user_id = p_user;
    delete from public.transaction_shares where user_id = p_user;
    delete from public.transactions where user_id = p_user;
    delete from public.accounts where user_id = p_user;
    delete from public.people where user_id = p_user;
    perform private.mirror_categories(p_user,
      (select k.value::jsonb from public.kv k where k.user_id = p_user and k.key = 'money-manager:v0:custom-categories'));
    if d is null then return; end if;

    insert into public.accounts (user_id, id, name, type, opening_balance_paise, opened_on, created_at)
    select p_user, a ->> 'id', a ->> 'name', a ->> 'type', coalesce((a ->> 'openingBalanceMinor')::bigint, 0),
           nullif(a ->> 'openedOn', '')::date, nullif(a ->> 'createdAt', '')::timestamptz
    from jsonb_array_elements(coalesce(d -> 'accounts', '[]'::jsonb)) a;

    insert into public.people (user_id, id, name, created_at)
    select p_user, p ->> 'id', p ->> 'name', nullif(p ->> 'createdAt', '')::timestamptz
    from jsonb_array_elements(coalesce(d -> 'people', '[]'::jsonb)) p;

    insert into public.transactions (user_id, id, type, date, amount_paise, account_id, from_account_id, to_account_id,
      holding_id, person_id, category_id, sold_value_paise, predates_records, description, note, from_statement,
      created_at, updated_at)
    select p_user, e ->> 'id', e ->> 'type', (e ->> 'date')::date,
           coalesce(e ->> 'amountMinor', e ->> 'totalMinor', e ->> 'proceedsMinor', e ->> 'valueMinor', '0')::bigint,
           e ->> 'accountId', e ->> 'fromAccountId', e ->> 'toAccountId', e ->> 'holdingId', e ->> 'personId',
           e ->> 'categoryId', (e ->> 'soldValueMinor')::bigint, (e ->> 'predatesRecords')::boolean,
           e ->> 'description', e ->> 'note', jsonb_array_length(coalesce(e -> 'sources', '[]'::jsonb)) > 0,
           nullif(e ->> 'createdAt', '')::timestamptz, nullif(e ->> 'updatedAt', '')::timestamptz
    from jsonb_array_elements(coalesce(d -> 'events', '[]'::jsonb)) e;

    insert into public.transaction_shares (user_id, transaction_id, position, person_id, amount_paise)
    select p_user, e ->> 'id', s.n, s.v ->> 'personId', (s.v ->> 'amountMinor')::bigint
    from jsonb_array_elements(coalesce(d -> 'events', '[]'::jsonb)) e
    cross join lateral jsonb_array_elements(coalesce(e -> 'shares', '[]'::jsonb)) with ordinality as s (v, n);

    insert into public.transaction_sources (user_id, transaction_id, position, import_id, statement_line_id, filename,
      line, narration, role)
    select p_user, e ->> 'id', s.n, s.v ->> 'importId', s.v ->> 'rowId', s.v ->> 'filename', (s.v ->> 'line')::int,
           s.v ->> 'narration', s.v ->> 'role'
    from jsonb_array_elements(coalesce(d -> 'events', '[]'::jsonb)) e
    cross join lateral jsonb_array_elements(coalesce(e -> 'sources', '[]'::jsonb)) with ordinality as s (v, n);

  elsif p_key = 'money-manager:v1:imports' then
    delete from public.statement_lines where user_id = p_user;
    delete from public.statement_imports where user_id = p_user;
    delete from public.rules where user_id = p_user;
    if d is null then return; end if;

    insert into public.statement_imports (user_id, id, filename, account_id, bank, account_mask, period_start, period_end,
      status, opening_balance_paise, closing_balance_paise, card_statement, ai_used, uploaded_at, imported_at)
    select p_user, i ->> 'id', i ->> 'filename', i ->> 'accountId', i ->> 'bankHint', i ->> 'accountMask',
           nullif(i ->> 'periodStart', '')::date, nullif(i ->> 'periodEnd', '')::date, i ->> 'status',
           (i ->> 'openingBalanceMinor')::bigint, (i ->> 'closingBalanceMinor')::bigint,
           (i ->> 'cardStatement')::boolean, (i ->> 'aiUsed')::boolean,
           nullif(i ->> 'uploadedAt', '')::timestamptz, nullif(i ->> 'importedAt', '')::timestamptz
    from jsonb_array_elements(coalesce(d -> 'imports', '[]'::jsonb)) i;

    insert into public.statement_lines (user_id, id, import_id, line_no, page, transaction_date, value_date, description,
      direction, amount_paise, balance_after_paise, reference, status, transaction_id)
    select p_user, r ->> 'id', r ->> 'importId', (r ->> 'index')::int, (r ->> 'sourcePage')::int,
           nullif(r ->> 'transactionDate', '')::date, nullif(r ->> 'valueDate', '')::date, r ->> 'rawDescription',
           r ->> 'direction', (r ->> 'amountMinor')::bigint, (r ->> 'balanceAfterMinor')::bigint,
           r ->> 'referenceNumber', r ->> 'status', r ->> 'eventId'
    from jsonb_array_elements(coalesce(d -> 'rows', '[]'::jsonb)) r;

    insert into public.rules (user_id, id, match_key, direction, event_type, category, person, counter_account_id,
      holding, always, confirmations, contradictions, updated_at)
    select p_user, u ->> 'id', u ->> 'key', u ->> 'direction', u ->> 'eventType', u ->> 'category', u ->> 'person',
           u ->> 'counterAccountId', u ->> 'holding', coalesce((u ->> 'always')::boolean, false),
           (u ->> 'confirmations')::int, (u ->> 'contradictions')::int, nullif(u ->> 'updatedAt', '')::timestamptz
    from jsonb_array_elements(coalesce(d -> 'rules', '[]'::jsonb)) u;

  elsif p_key = 'money-manager:v0:custom-categories' then
    perform private.mirror_categories(p_user, d);
  end if;
end
$$;

-- Never lets a refresh problem fail the app's save: the subtransaction is rolled back and a warning logged.
create or replace function private.mirror_kv_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform private.mirror_kv(old.user_id, old.key, null);
    else
      perform private.mirror_kv(new.user_id, new.key, new.value);
    end if;
  exception when others then
    raise warning 'money manager: readable tables not refreshed (%): %', sqlstate, sqlerrm;
  end;
  return null;
end
$$;

drop trigger if exists mirror_kv on public.kv;
create trigger mirror_kv after insert or update or delete on public.kv
  for each row execute function private.mirror_kv_trigger();

-- Transactions with names instead of ids, newest first when sorted by date.
create or replace view public.transaction_list with (security_invoker = true) as
select t.user_id, t.date, t.type, t.amount, c.name as category, a.name as account, fa.name as from_account,
       ta.name as to_account, h.name as investment, p.name as person, t.description, t.note, t.from_statement, t.id
from public.transactions t
left join public.categories c on c.user_id = t.user_id and c.id = t.category_id
left join public.accounts a on a.user_id = t.user_id and a.id = t.account_id
left join public.accounts fa on fa.user_id = t.user_id and fa.id = t.from_account_id
left join public.accounts ta on ta.user_id = t.user_id and ta.id = t.to_account_id
left join public.accounts h on h.user_id = t.user_id and h.id = t.holding_id
left join public.people p on p.user_id = t.user_id and p.id = t.person_id;
revoke all on public.transaction_list from anon;
grant select on public.transaction_list to authenticated;

-- Fill the tables from what is already saved.
select private.mirror_kv(user_id, key, value) from public.kv order by key;
