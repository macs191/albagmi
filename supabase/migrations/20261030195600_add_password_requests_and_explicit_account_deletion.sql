-- Password requests keep only authenticated ciphertext until the manager reviews them.
create table if not exists public.albagmi_password_change_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.albagmi_accounts(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  password_ciphertext text,
  password_iv text,
  password_tag text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint albagmi_password_request_secret_status_check check (
    (status = 'pending' and password_ciphertext is not null and password_iv is not null and password_tag is not null)
    or (status in ('approved', 'rejected') and password_ciphertext is null and password_iv is null and password_tag is null)
  )
);

create unique index if not exists albagmi_one_pending_password_request_per_user_idx
  on public.albagmi_password_change_requests (auth_user_id)
  where status = 'pending';

alter table public.albagmi_password_change_requests enable row level security;
revoke all on table public.albagmi_password_change_requests from public, anon, authenticated;
grant all on table public.albagmi_password_change_requests to service_role;

comment on table public.albagmi_password_change_requests is
  'Manager-reviewed office password changes. Pending secret material is AES-GCM ciphertext only and is cleared after review.';

-- The manager's explicit permanent-delete action removes the Auth user and, by cascade,
-- the linked office account, pending password requests, and UID-scoped office data.
alter table public.albagmi_user_data
  drop constraint if exists albagmi_user_data_user_id_fkey;

alter table public.albagmi_user_data
  add constraint albagmi_user_data_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
