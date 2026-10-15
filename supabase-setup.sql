-- supabase-setup.sql — รันครั้งเดียวหลังสร้างโปรเจกต์ Supabase ใหม่ (SQL Editor > New query > Run)
-- ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี — คนละโปรเจกต์กับ "สำนักปลัด อบจ.สุพรรณบุรี" โดยสิ้นเชิง

-- ═══ 1. ตารางหลัก ═══
create table if not exists staff (
  line_uid     text primary key,
  display_name text,
  role         text not null default 'staff' check (role in ('admin','staff')),
  active       boolean not null default true,
  email        text,
  notify_line  boolean not null default true,
  notify_email boolean not null default true,
  added_at     timestamptz not null default now()
);

create table if not exists staff_requests (
  line_uid     text primary key,
  display_name text,
  requested_at timestamptz not null default now()
);

create table if not exists cases (
  id            bigint generated always as identity primary key,
  case_no       text unique not null,
  case_type     text not null check (case_type in ('consult','complaint','appointment')),
  category      text not null default 'other',
  citizen_name  text,
  citizen_phone text,
  citizen_line_uid text,
  is_anonymous  boolean not null default false,
  detail        text not null,
  respondent    text,
  demand        text,
  evidence_paths text[] not null default '{}',
  preferred_date date,                                  -- ใช้เฉพาะ case_type='appointment' (จองคิวทนายอาสา)
  preferred_time_slot text check (preferred_time_slot in ('morning','afternoon')),
  satisfaction_rating smallint check (satisfaction_rating between 1 and 5),  -- ขอหลังปิดเรื่อง (แนวคิดจาก Traffy Fondue)
  satisfaction_rated_at timestamptz,
  status        text not null default 'new' check (status in ('new','assigned','in_progress','need_info','closed')),
  assigned_staff_uid text references staff(line_uid),
  internal_note text,
  pdpa_consent  boolean not null default false,
  pdpa_consent_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index if not exists cases_status_idx on cases(status);
create index if not exists cases_uid_idx on cases(citizen_line_uid);
create index if not exists cases_created_idx on cases(created_at desc);

create table if not exists case_events (
  id         bigint generated always as identity primary key,
  case_id    bigint not null references cases(id) on delete cascade,
  actor      text not null,
  action     text not null,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists case_events_case_idx on case_events(case_id);

create table if not exists settings (
  key   text primary key,
  value jsonb not null
);

create table if not exists keyword_log (
  id bigint generated always as identity primary key,
  topic text, raw_text text, line_uid text,
  created_at timestamptz not null default now()
);

-- ═══ 2. เลขที่เรื่องอัตโนมัติ (atomic กันชนกันตอนยื่นพร้อมกัน) ═══
-- รูปแบบ LG-<พ.ศ.ปีปัจจุบัน>-<เลข 6 หลัก> เช่น LG-2569-000001
create sequence if not exists case_seq start 1;

create or replace function next_case_no() returns text as $$
declare
  ce_year int := extract(year from (now() at time zone 'Asia/Bangkok'))::int;
  buddhist_year int := ce_year + 543;
  n bigint := nextval('case_seq');
begin
  return 'LG-' || buddhist_year::text || '-' || lpad(n::text, 6, '0');
end;
$$ language plpgsql;

-- ═══ 3. RLS — ปิด client-side access ทั้งหมด ทุกอย่างผ่าน service key จากเซิร์ฟเวอร์เท่านั้น ═══
alter table staff enable row level security;
alter table staff_requests enable row level security;
alter table cases enable row level security;
alter table case_events enable row level security;
alter table settings enable row level security;
alter table keyword_log enable row level security;
-- ไม่สร้าง policy ใดๆ เจตนา — service key (ที่ใช้ในโค้ด api/_db.js) bypass RLS ได้อยู่แล้ว
-- ส่วน anon key (ที่ฝังใน complaint.html สำหรับอัปโหลดไฟล์เท่านั้น) จะอ่าน/เขียนตารางเหล่านี้ไม่ได้เลย

-- ═══ 4. ค่าตั้งค่าเริ่มต้น (ดู api/_settings.js DEFAULTS — ต้องตรงกัน) ═══
insert into settings (key, value) values
  ('office_hours', '{"days":"จันทร์–ศุกร์","start":"08:30","end":"16:30"}'),
  ('phone', '"035-431-751"'),
  ('map_url', '"https://maps.google.com/?q=%E0%B8%AD%E0%B8%87%E0%B8%84%E0%B9%8C%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%AB%E0%B8%B2%E0%B8%A3%E0%B8%AA%E0%B9%88%E0%B8%A7%E0%B8%99%E0%B8%88%E0%B8%B1%E0%B8%87%E0%B8%AB%E0%B8%A7%E0%B8%B1%E0%B8%94%E0%B8%AA%E0%B8%B8%E0%B8%9E%E0%B8%A3%E0%B8%A3%E0%B8%93%E0%B8%9A%E0%B8%B8%E0%B8%A3%E0%B8%B5"'),  -- encodeURIComponent แล้ว (บั๊กจริง 16 ก.ย. 69 — ห้ามใส่ Thai ดิบ)
  ('responder_label', '"เจ้าหน้าที่"'),
  ('appointment_enabled', 'true'),
  ('holidays', '[]')
on conflict (key) do nothing;

-- ═══ 5. Storage bucket สำหรับหลักฐานร้องเรียน — private เด็ดขาด ห้ามตั้ง public ═══
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 8388608, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;
-- ไม่สร้าง storage policy ใดๆ เจตนา — เข้าถึงผ่าน signed URL (upload/download) ที่ออกโดย service key
-- จากเซิร์ฟเวอร์เท่านั้น (ดู api/_evidence.js) ไม่มี policy = ไม่มีใครอ่าน/เขียนตรงได้แม้มี anon key

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select * from settings; select next_case_no(); ═══
