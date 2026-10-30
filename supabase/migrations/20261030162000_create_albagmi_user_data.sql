create table if not exists public.albagmi_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_state jsonb not null default '{}'::jsonb check (jsonb_typeof(app_state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.albagmi_user_data enable row level security;
revoke all on table public.albagmi_user_data from public, anon, authenticated;
grant all on table public.albagmi_user_data to service_role;

-- Preserve each existing account state by its Supabase Auth UID; never overwrite an existing row.
insert into public.albagmi_user_data (user_id, app_state, created_at, updated_at)
select auth_user_id, app_state, created_at, updated_at
from public.albagmi_accounts
on conflict (user_id) do nothing;

comment on table public.albagmi_user_data is
  'albagmi app records keyed by Supabase Auth UID; accessed only through the trusted server-side Vercel API.';
