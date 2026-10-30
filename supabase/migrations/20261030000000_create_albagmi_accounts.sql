create table if not exists public.albagmi_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  office_name text not null check (char_length(trim(office_name)) between 1 and 120),
  owner_name text not null check (char_length(trim(owner_name)) between 1 and 120),
  phone text not null check (char_length(trim(phone)) between 3 and 40),
  subscription_started_at timestamptz not null default now(),
  subscription_days integer not null check (subscription_days between 1 and 36500),
  subscription_ends_at timestamptz not null,
  app_state jsonb not null default '{}'::jsonb check (jsonb_typeof(app_state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists albagmi_accounts_subscription_ends_at_idx
  on public.albagmi_accounts (subscription_ends_at);

alter table public.albagmi_accounts enable row level security;
revoke all on table public.albagmi_accounts from anon, authenticated;
grant all on table public.albagmi_accounts to service_role;
comment on table public.albagmi_accounts is
  'Isolated albagmi subscriptions and application state; accessed through the trusted server-side Vercel API.';
