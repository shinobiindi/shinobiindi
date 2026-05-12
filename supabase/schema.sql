create table if not exists public.access_keys (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text,
  is_active boolean not null default true,
  expired_at timestamptz,
  fingerprint_id text,
  session_token text,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  access_key_id uuid references public.access_keys(id) on delete set null,
  reason text not null,
  detected_fingerprint text,
  created_at timestamptz not null default now()
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  pair text not null default 'XAUUSD',
  mode text not null check (mode in ('scalping', 'intraday')),
  type text not null check (type in ('buy', 'sell')),
  entry_target numeric(10,2) not null,
  live_price numeric(10,2) not null,
  sl numeric(10,2) not null,
  tp1 numeric(10,2) not null,
  tp2 numeric(10,2) not null,
  tp3 numeric(10,2),
  max_floating_pips numeric(10,2) not null default 0,
  status text not null default 'active' check (status in ('active', 'closed')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.performance_logs (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('scalping', 'intraday')),
  type text not null check (type in ('buy', 'sell')),
  outcome text not null check (outcome in ('tp1', 'tp2', 'tp3', 'sl', 'be')),
  net_pips numeric(10,2) not null,
  peak_pips numeric(10,2),
  created_at timestamptz not null default now()
);

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  introducer text,
  package_name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists public.performance_log_edits (
  id uuid primary key default gen_random_uuid(),
  performance_log_id uuid references public.performance_logs(id) on delete cascade,
  actor text not null default 'admin',
  note text,
  before_data jsonb not null,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.package_links (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  package_name text not null,
  duration_days integer not null check (duration_days > 0),
  agent_name text,
  click_count integer not null default 0,
  last_clicked_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.link_redemptions (
  id uuid primary key default gen_random_uuid(),
  package_link_id uuid not null references public.package_links(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete set null,
  email_normalized text,
  phone_normalized text,
  created_at timestamptz not null default now()
);

alter table public.access_keys add column if not exists subscriber_id uuid references public.subscribers(id) on delete set null;
alter table public.access_keys add column if not exists is_active boolean not null default true;
alter table public.subscribers add column if not exists introducer text;
alter table public.package_links add column if not exists agent_name text;
alter table public.package_links add column if not exists click_count integer not null default 0;
alter table public.package_links add column if not exists last_clicked_at timestamptz;
create unique index if not exists access_keys_one_per_subscriber on public.access_keys(subscriber_id) where subscriber_id is not null;
create unique index if not exists subscribers_email_unique_ci on public.subscribers (lower(email));
create unique index if not exists link_redemptions_link_email_unique
  on public.link_redemptions(package_link_id, email_normalized)
  where email_normalized is not null;
create unique index if not exists link_redemptions_link_phone_unique
  on public.link_redemptions(package_link_id, phone_normalized)
  where phone_normalized is not null;

-- Backfill/repair for existing databases where outcome constraint was created without `be`.
do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'performance_logs'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%outcome%';

  if constraint_name is not null then
    execute format('alter table public.performance_logs drop constraint %I', constraint_name);
  end if;

  alter table public.performance_logs
    add constraint performance_logs_outcome_check
    check (outcome in ('tp1', 'tp2', 'tp3', 'sl', 'be'));
end $$;

alter table public.access_keys enable row level security;
alter table public.security_alerts enable row level security;
alter table public.signals enable row level security;
alter table public.performance_logs enable row level security;
alter table public.subscribers enable row level security;
alter table public.performance_log_edits enable row level security;
alter table public.package_links enable row level security;
alter table public.link_redemptions enable row level security;

create policy "anon_can_read_signals" on public.signals for select to anon using (true);
create policy "anon_can_read_logs" on public.performance_logs for select to anon using (true);
drop policy if exists "anon_can_read_access_keys" on public.access_keys;
drop policy if exists "anon_can_update_access_keys" on public.access_keys;
create policy "anon_can_read_access_keys" on public.access_keys for select to anon using (is_active = true);
create policy "anon_can_update_access_keys" on public.access_keys for update to anon
  using (is_active = true and (expired_at is null or expired_at > now()))
  with check (is_active = true and (expired_at is null or expired_at > now()));
create policy "anon_can_insert_alerts" on public.security_alerts for insert to anon with check (true);

-- Restrict anon updates to session-bound fields only.
revoke update (key, label, is_active, expired_at, subscriber_id) on public.access_keys from anon;
grant update (fingerprint_id, session_token, last_login_at) on public.access_keys to anon;

alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.performance_logs;
alter publication supabase_realtime add table public.access_keys;
