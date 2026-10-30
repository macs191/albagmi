alter table public.albagmi_user_data
  drop constraint if exists albagmi_user_data_user_id_fkey;

alter table public.albagmi_user_data
  add constraint albagmi_user_data_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete restrict;
