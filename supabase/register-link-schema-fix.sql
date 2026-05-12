-- Run this in the Supabase SQL Editor if the register page reports
-- that public.link_redemptions or public.package_links is missing.

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

alter table public.package_links enable row level security;
alter table public.link_redemptions enable row level security;
