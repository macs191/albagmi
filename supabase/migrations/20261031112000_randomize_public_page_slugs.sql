-- Do not expose office login usernames in public URLs; links remain stable after this migration.
update public.albagmi_accounts
set public_slug = 'office-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
