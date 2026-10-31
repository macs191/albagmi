-- Stable public path for each office, independent of its mutable login username.
alter table public.albagmi_accounts
  add column if not exists public_slug text;

update public.albagmi_accounts
set public_slug = lower(username)
where public_slug is null or btrim(public_slug) = '';

alter table public.albagmi_accounts
  alter column public_slug set not null;

create unique index if not exists albagmi_accounts_public_slug_uidx
  on public.albagmi_accounts (public_slug);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'albagmi_accounts_public_slug_format_check'
      and conrelid = 'public.albagmi_accounts'::regclass
  ) then
    alter table public.albagmi_accounts
      add constraint albagmi_accounts_public_slug_format_check
      check (public_slug = lower(public_slug) and public_slug ~ '^[a-z0-9._-]{3,40}$');
  end if;
end;
$$;
