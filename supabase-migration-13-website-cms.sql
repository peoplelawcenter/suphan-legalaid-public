-- supabase-migration-13-website-cms.sql
-- เว็บไซต์ไดนามิก + หลังบ้านจัดการเนื้อหา (CMS) — บอสสั่ง 30 ก.ย. 69: "รื้อหน้า web ใหม่ ทำแบบ dynamic website
-- มี banner มี social มีระบบ backend admin ตัวอย่าง https://www.lawyerscouncil.or.th/" (สเปกเต็ม docs/WEBSITE-SPEC.md)
--
-- มติบอส (AskUserQuestion 30 ก.ย. 69): เนื้อหาครบ 4 ส่วน (ข่าว/กิจกรรม/ประกาศ · เกี่ยวกับศูนย์+ผู้บริหาร/ทนายอาสา ·
-- ความรู้กฎหมาย+FAQ · เอกสารดาวน์โหลด) · คนแก้เว็บได้ = แอดมิน + คนที่แอดมินให้สิทธิ์ "ผู้ดูแลเว็บไซต์"
--
-- ✅ รันซ้ำได้ปลอดภัย (if not exists / on conflict do nothing ทุกคำสั่ง)
-- ✅ ไม่แตะข้อมูลเดิม — แก้ตารางเดิมจุดเดียว: เพิ่ม staff.can_edit_site (ค่าเริ่มต้น false = ไม่มีใครได้สิทธิ์เพิ่มจนกว่าแอดมินจะติ๊ก)
-- 🔒 RLS เปิดทุกตารางใหม่และ "ไม่มี policy" = anon/authenticated อ่าน/เขียนตรงไม่ได้ ต้องผ่าน service key ฝั่งเซิร์ฟเวอร์เท่านั้น
--    (แบบเดียวกับทุกตารางเดิมของโปรเจกต์นี้ — หน้าเว็บสาธารณะอ่านผ่าน api/site.js ที่กรองเฉพาะของที่เผยแพร่แล้ว)

-- ═══ 1) สิทธิ์ "ผู้ดูแลเว็บไซต์" ═══
alter table public.staff add column if not exists can_edit_site boolean not null default false;

-- ═══ 2) updated_at อัตโนมัติทุกตารางเนื้อหา (โค้ดไม่ต้องจำใส่เอง) ═══
create or replace function public.site_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ═══ 3) แบนเนอร์สไลด์หน้าแรก ═══
create table if not exists public.site_banners (
  id                bigint generated always as identity primary key,
  alt_text          text not null check (char_length(alt_text) between 1 and 200),   -- คำอธิบายรูป (บังคับ — ผู้พิการทางสายตา/SEO)
  caption           text check (caption is null or char_length(caption) <= 200),    -- ข้อความทับรูป (ว่าง = ไม่แสดง)
  image_path        text not null,                                                   -- รูปหลัก (แนะนำ 1920×640)
  image_w           int check (image_w is null or image_w between 1 and 10000),
  image_h           int check (image_h is null or image_h between 1 and 10000),
  mobile_image_path text,                                                            -- รูปเฉพาะมือถือ (ไม่บังคับ)
  link_url          text check (link_url is null or char_length(link_url) <= 1000),
  sort_order        int not null default 0,
  active            boolean not null default true,
  starts_at         timestamptz,                                                     -- ว่าง = แสดงทันที
  ends_at           timestamptz,                                                     -- ว่าง = ไม่หมดอายุ
  created_by        bigint references public.staff(id) on delete set null,
  updated_by        bigint references public.staff(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint site_banners_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists site_banners_order_idx on public.site_banners (active, sort_order, id);

-- ═══ 4) ข่าว/กิจกรรม/ประกาศ/บทความความรู้กฎหมาย (ตารางเดียว แยกด้วย category) ═══
create table if not exists public.site_posts (
  id               bigint generated always as identity primary key,
  category         text not null check (category in ('news', 'activity', 'announcement', 'knowledge')),
  title            text not null check (char_length(title) between 1 and 300),
  excerpt          text check (excerpt is null or char_length(excerpt) <= 500),
  body_html        text not null default '' check (char_length(body_html) <= 200000), -- ผ่าน sanitizeRichHtml() แล้วเท่านั้น
  cover_path       text,
  cover_thumb_path text,
  cover_w          int check (cover_w is null or cover_w between 1 and 10000),
  cover_h          int check (cover_h is null or cover_h between 1 and 10000),
  cover_alt        text check (cover_alt is null or char_length(cover_alt) <= 200),
  gallery          jsonb not null default '[]'::jsonb check (jsonb_typeof(gallery) = 'array'),      -- [{path,thumb_path,alt,w,h}]
  attachments      jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),  -- [{path,name,size,type}]
  status           text not null default 'draft' check (status in ('draft', 'published')),
  pinned           boolean not null default false,
  published_at     timestamptz,                                                     -- อนาคต = ตั้งเวลาเผยแพร่
  author_staff_id  bigint references public.staff(id) on delete set null,
  updated_by       bigint references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists site_posts_public_idx on public.site_posts (category, status, published_at desc);

-- ═══ 5) หน้าเนื้อหาแก้ได้ (เกี่ยวกับศูนย์ / นโยบายคุ้มครองข้อมูลส่วนบุคคล / นโยบายคุกกี้ / หน้าที่แอดมินสร้างเพิ่ม) ═══
create table if not exists public.site_pages (
  slug         text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 40),
  title        text not null check (char_length(title) between 1 and 200),
  body_html    text not null default '' check (char_length(body_html) <= 200000),
  show_in_menu boolean not null default false,
  sort_order   int not null default 0,
  published    boolean not null default true,
  updated_by   bigint references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ═══ 6) บุคลากร: ผู้บริหาร / ทนายอาสา / เจ้าหน้าที่ศูนย์ (ชื่อ-รูปแอดมินกรอกเอง — ห้ามระบบเดาใส่) ═══
create table if not exists public.site_people (
  id               bigint generated always as identity primary key,
  group_key        text not null check (group_key in ('executive', 'lawyer', 'staff')),
  name             text not null check (char_length(name) between 1 and 150),
  position         text check (position is null or char_length(position) <= 200),
  organization     text check (organization is null or char_length(organization) <= 200),
  photo_path       text,
  photo_thumb_path text,
  bio              text check (bio is null or char_length(bio) <= 1000),
  show_on_home     boolean not null default false,                                  -- กล่องข้างข่าวหน้าแรก (แบบ "นายกสภาทนายความ")
  sort_order       int not null default 0,
  active           boolean not null default true,
  updated_by       bigint references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists site_people_order_idx on public.site_people (group_key, active, sort_order, id);

-- ═══ 7) คำถามที่พบบ่อย ═══
create table if not exists public.site_faqs (
  id          bigint generated always as identity primary key,
  question    text not null check (char_length(question) between 1 and 300),
  answer_html text not null default '' check (char_length(answer_html) <= 50000),   -- ผ่าน sanitizeRichHtml() แล้วเท่านั้น
  category    text check (category is null or char_length(category) <= 80),
  sort_order  int not null default 0,
  active      boolean not null default true,
  updated_by  bigint references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ═══ 8) เอกสารดาวน์โหลด (PDF / Word / Excel) ═══
create table if not exists public.site_documents (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 1 and 300),
  description  text check (description is null or char_length(description) <= 1000),
  category     text check (category is null or char_length(category) <= 80),
  file_path    text not null,
  file_name    text check (file_name is null or char_length(file_name) <= 200),
  file_size    bigint check (file_size is null or file_size >= 0),
  file_type    text check (file_type is null or char_length(file_type) <= 120),
  sort_order   int not null default 0,
  active       boolean not null default true,
  published_at timestamptz not null default now(),
  updated_by   bigint references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ═══ 9) ลิงก์: โซเชียล + หน่วยงานที่เกี่ยวข้อง ═══
create table if not exists public.site_links (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('social', 'related')),
  label      text not null check (char_length(label) between 1 and 120),
  url        text not null check (char_length(url) between 1 and 1000),
  icon       text check (icon is null or icon ~ '^[a-z0-9_-]{1,30}$'),
  logo_path  text,
  sort_order int not null default 0,
  active     boolean not null default true,
  updated_by bigint references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══ 10) ประวัติการแก้ไขเว็บ (ใครแก้อะไรเมื่อไร — ความรับผิดชอบของเว็บหน่วยงานรัฐ) ═══
create table if not exists public.site_audit (
  id        bigint generated always as identity primary key,
  staff_id  bigint references public.staff(id) on delete set null,
  action    text not null check (char_length(action) <= 30),
  item_type text not null check (char_length(item_type) <= 30),
  item_id   text check (item_id is null or char_length(item_id) <= 60),
  summary   text check (summary is null or char_length(summary) <= 300),
  at        timestamptz not null default now()
);
create index if not exists site_audit_at_idx on public.site_audit (at desc);

-- ═══ 11) RLS + ทริกเกอร์ updated_at ═══
do $$
declare t text;
begin
  foreach t in array array['site_banners', 'site_posts', 'site_pages', 'site_people', 'site_faqs', 'site_documents', 'site_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.site_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;
alter table public.site_audit enable row level security;

-- ═══ 12) ที่เก็บไฟล์เว็บ "site-media" (public — รูป/เอกสารเผยแพร่ ไม่มีข้อมูลส่วนบุคคล) ═══
-- ⛔ คนละ bucket กับ "evidence" (หลักฐานร้องเรียน private เด็ดขาด) · อัปโหลดได้ทาง signed upload URL ที่ api/_cms.js ออกให้
--    ผู้มีสิทธิ์แก้เว็บเท่านั้น (ไม่มี storage policy ให้ anon) · ไม่มี policy = anon list ไฟล์ไม่ได้ อ่านได้เฉพาะคนที่รู้ URL
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do nothing;
