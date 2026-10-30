alter table public.albagmi_accounts
  add column if not exists is_active boolean not null default true,
  add column if not exists login_count bigint not null default 0,
  add column if not exists last_login_at timestamptz;

create table if not exists public.albagmi_site_visitors (
  visitor_id uuid primary key,
  first_seen_at timestamptz not null default now()
);

alter table public.albagmi_site_visitors enable row level security;
revoke all on table public.albagmi_site_visitors from anon, authenticated;
grant all on table public.albagmi_site_visitors to service_role;

create or replace function public.albagmi_increment_login(p_account_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_login_count bigint;
begin
  update public.albagmi_accounts
     set login_count = coalesce(login_count, 0) + 1,
         last_login_at = now(),
         updated_at = now()
   where id = p_account_id
   returning login_count into updated_login_count;

  return updated_login_count;
end;
$$;

revoke all on function public.albagmi_increment_login(uuid) from public, anon, authenticated;
grant execute on function public.albagmi_increment_login(uuid) to service_role;

comment on table public.albagmi_site_visitors is
  'Stores anonymous first-party random browser UUIDs only; no IP address or personal profile data.';
