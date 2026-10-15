-- supabase-migration-7-staff-accounts.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนใช้ระบบล็อกอินเจ้าหน้าที่แบบใหม่ที่เพิ่ม 17 ก.ย. 69 รอบ 3 — บอสสั่ง "ให้ฝั่ง LINE OA เป็นของ
-- ประชาชนไปเลย" จึงย้ายเจ้าหน้าที่ทั้งหมดออกจาก LINE ไปเป็นเว็บสมัครสมาชิกอีเมล+รหัสผ่าน+ยืนยัน OTP แทน
-- ⚠️ เปลี่ยนโครงสร้างตาราง staff ค่อนข้างมาก อ่านให้ครบก่อนรัน — ถ้ามีเจ้าหน้าที่/เรื่องที่มอบหมายแล้วจริง
-- อยู่ก่อนแล้ว สคริปต์นี้ backfill ข้อมูลเดิมให้อัตโนมัติ ไม่ต้องทำมือเพิ่ม)

-- ═══ 1. staff: ย้าย PK จาก line_uid (บังคับต้องมี) → id ใหม่ (line_uid กลายเป็น "ทางเลือกเสริม") ═══
alter table staff add column if not exists id bigint generated always as identity;
-- ⚠️ แก้ 18 ก.ย. 69 — บอสรันจริงแล้วเจอ error "cannot drop constraint staff_pkey ... because other
-- objects depend on it (cases_assigned_staff_uid_fkey)" เพราะ supabase-setup.sql เดิมมี
-- `cases.assigned_staff_uid text references staff(line_uid)` ผูก FK ไว้กับ staff_pkey โดยตรง (ตอนนั้น
-- line_uid ยังเป็น PK) ต้องตัด FK เส้นนี้ก่อนถึงจะย้าย PK ได้ — ไม่สร้าง FK ใหม่แทนเพราะคอลัมน์
-- assigned_staff_uid กลายเป็น "ประวัติเฉยๆ" ตั้งแต่ตอนนี้แล้ว (โค้ดใหม่ใช้ assigned_staff_id แทนทั้งหมด
-- ดูข้อ 3 ด้านล่าง) ไม่มีอะไรเขียนคอลัมน์นี้เพิ่มอีกแล้วจึงไม่ต้องบังคับ referential integrity ต่อ
alter table cases drop constraint if exists cases_assigned_staff_uid_fkey;
alter table staff drop constraint if exists staff_pkey;
alter table staff add constraint staff_pkey primary key (id);
alter table staff alter column line_uid drop not null;
alter table staff drop constraint if exists staff_line_uid_key;
alter table staff add constraint staff_line_uid_key unique (line_uid);

-- ═══ 2. staff: คอลัมน์ใหม่สำหรับระบบสมัครสมาชิกอีเมล+รหัสผ่าน+OTP ═══
alter table staff add column if not exists password_hash text;
alter table staff add column if not exists email_verified_at timestamptz;
-- approved_at แยกจาก active โดยตั้งใจ: active ใช้ถอน/คืนสิทธิ์คนที่เคยอนุมัติแล้ว, approved_at null =
-- ยังไม่เคยถูกอนุมัติเลย (สมัครใหม่รอคิว) ป้องกันปนกันระหว่าง "เพิ่งสมัคร" กับ "เคยอนุมัติแต่ถูกถอนสิทธิ์"
alter table staff add column if not exists approved_at timestamptz;
alter table staff add column if not exists otp_hash text;
alter table staff add column if not exists otp_expires_at timestamptz;
alter table staff add column if not exists otp_attempts smallint not null default 0;

-- เจ้าหน้าที่เดิมที่เคยอนุมัติผ่านระบบ LINE (บอสเอง/ทีมที่เพิ่มไว้ก่อนรอบนี้) ให้ถือว่า approved_at = added_at
-- กันหายไปจากรายชื่อ "เจ้าหน้าที่ที่ใช้งานอยู่" หลังเปลี่ยนระบบ (ยังต้องสมัครบัญชีเว็บใหม่ด้วยอีเมลเองอยู่ดี
-- ก่อนจะล็อกอินได้จริง — แถวเดิมแค่ไม่ถูกนับเป็น "คำขอค้าง" ที่ไม่มีใครอนุมัติมาก่อน)
update staff set approved_at = added_at where approved_at is null;

-- อีเมลต้องไม่ซ้ำกัน (อนุญาต null ไว้สำหรับแถวเก่าที่ยังไม่เคยตั้งอีเมล — unique index แบบนี้ไม่บังคับ null)
create unique index if not exists staff_email_unique_idx on staff (lower(email)) where email is not null;

-- ═══ 3. cases: มอบหมายเจ้าหน้าที่ด้วย staff.id แทน line_uid (เพราะเจ้าหน้าที่ไม่จำเป็นต้องมี LINE อีกต่อไป) ═══
alter table cases add column if not exists assigned_staff_id bigint references staff(id);
update cases set assigned_staff_id = s.id
  from staff s where cases.assigned_staff_uid = s.line_uid and cases.assigned_staff_id is null;
-- ไม่ลบคอลัมน์ assigned_staff_uid เดิม (เก็บไว้เป็นประวัติ/เผื่อย้อนกลับ) แค่โค้ดใหม่ไม่อ่าน/เขียนคอลัมน์นี้แล้ว

-- ═══ 4. รหัสเชื่อมบัญชี LINE (ไม่บังคับ — ใช้เฉพาะเจ้าหน้าที่ที่อยากรับแจ้งเตือนผ่าน LINE เสริมจากอีเมล) ═══
create table if not exists staff_link_codes (
  code       text primary key,
  staff_id   bigint not null references staff(id) on delete cascade,
  expires_at timestamptz not null
);
alter table staff_link_codes enable row level security;

-- หมายเหตุ: ตาราง staff_requests (ระบบขอสิทธิ์ผ่าน LINE เดิม) เลิกใช้แล้วตั้งแต่รอบนี้ — ไม่ลบตาราง
-- (เผื่อย้อนกลับ) แค่ไม่มีโค้ดจุดไหนอ่าน/เขียนอีกต่อไป คำขอสิทธิ์ใหม่ทั้งหมดมาจากการสมัครสมาชิกเว็บแทน

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='staff' and column_name in ('id','password_hash','email_verified_at','approved_at');
-- select conname from pg_constraint where conname='staff_pkey'; ต้องเห็น primary key ผูกกับ id ไม่ใช่ line_uid
-- select conname from pg_constraint where conname='cases_assigned_staff_uid_fkey'; ต้องไม่เจอแถวเลย (ตัดทิ้งแล้ว) ═══
