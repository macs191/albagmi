create table if not exists public.albagmi_site_catalog (
  id text primary key check (char_length(id) between 3 and 120),
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null check (char_length(trim(category)) between 1 and 80),
  url text not null check (char_length(url) between 8 and 2048),
  image text not null default '' check (char_length(image) <= 2048),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.albagmi_site_catalog enable row level security;
revoke all on table public.albagmi_site_catalog from anon, authenticated;
grant all on table public.albagmi_site_catalog to service_role;
insert into public.albagmi_site_catalog (id,name,category,url,image,sort_order) values
('site-tameeni','تأميني','التأمين','https://www.tameeni.com/','https://www.google.com/s2/favicons?domain=www.tameeni.com&sz=128',10),
('site-najm','نجم','الحوادث والتأمين','https://najm.sa/','https://www.google.com/s2/favicons?domain=najm.sa&sz=128',20),
('site-transport','الهيئة العامة للنقل','النقل والتراخيص','https://tga.gov.sa/','https://www.google.com/s2/favicons?domain=tga.gov.sa&sz=128',30),
('site-absher','أبشر','الخدمات الحكومية','https://www.absher.sa/','https://www.google.com/s2/favicons?domain=www.absher.sa&sz=128',40),
('site-najiz','ناجز','الخدمات الحكومية','https://najiz.sa/','',50),
('site-nafath','نفاذ','الخدمات الحكومية','https://www.iam.gov.sa/','',60),
('site-balady','بلدي','المنشآت والبلديات','https://balady.gov.sa/','https://www.google.com/s2/favicons?domain=balady.gov.sa&sz=128',70),
('site-business','منصة الأعمال','المنشآت والبلديات','https://business.sa/','',80),
('site-ia','هيئة التأمين','التأمين','https://www.ia.gov.sa/','',90)
on conflict (id) do nothing;
