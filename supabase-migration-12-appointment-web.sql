-- supabase-migration-12-appointment-web.sql — รันใน Supabase SQL Editor ของโปรเจกต์ศูนย์ฯ (ไม่ใช่สำนักปลัด)
-- เพิ่ม 30 ก.ย. 69: "แบบคำร้องขอเข้ารับคำปรึกษาทางกฎหมาย" (public/appointment.html) ใช้ได้ทั้งจากไลน์และจากเว็บ
-- ต้องรันหลัง supabase-migration-2-appointment.sql (คอลัมน์ preferred_date/preferred_time_slot)
--
-- ✅ idempotent ทุกบรรทัด — รันซ้ำกี่รอบก็ได้ผลเท่าเดิม ไม่ลบข้อมูลใด
-- ✅ ยังไม่รันไฟล์นี้ ระบบก็รับเรื่องได้ปกติ: api/_cases.js บันทึกใหม่แบบไม่มีคอลัมน์ใหม่แล้วต่อท้าย
--    รายละเอียดด้วย "เวลาที่สะดวก HH:MM น. · อำเภอ · ช่องทาง" แทน + เพดานกันสแปมต่อ IP ถอยไปนับในหน่วยความจำ
--    (ดู docs/BOOKING-FORM.md หัวข้อ "ถ้ายังไม่รัน migration-12")

-- 1) เวลาที่ขอเข้ารับคำปรึกษาแบบรายชั่วโมง 'HH:MM' (ชุดที่อนุญาตคุมที่ api/_appointment.js APPT_TIMES —
--    DB ตรวจแค่รูปแบบ เพื่อให้ปรับชุดเวลาในโค้ดได้โดยไม่ต้องแก้ constraint) · preferred_time_slot เดิมยังบันทึกคู่เสมอ
alter table cases add column if not exists preferred_time text;
alter table cases drop constraint if exists cases_preferred_time_format_check;
alter table cases add constraint cases_preferred_time_format_check
  check (preferred_time is null or preferred_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- 2) ช่องทางที่ยื่นเรื่อง: 'line' (ลิงก์ ?k= จากบอท) | 'web' (เปิดฟอร์มตรงจากเว็บ ไม่มี citizen_line_uid)
--    default 'line' = เรื่องเก่าทั้งหมดก่อนวันนี้มาจากไลน์ (ทุกฟอร์มเดิมบังคับลิงก์ ?k=)
alter table cases add column if not exists source text not null default 'line';
alter table cases drop constraint if exists cases_source_check;
alter table cases add constraint cases_source_check check (source in ('line', 'web'));
-- เรื่องจากเว็บที่เข้ามาก่อนรันไฟล์นี้ (ไม่มี uid) แก้ช่องทางให้ถูก — รันซ้ำไม่มีผลเพิ่ม
update cases set source = 'web'
  where case_type = 'appointment' and citizen_line_uid is null and source <> 'web';

-- 3) อำเภอที่อยู่ (เก็บแค่อำเภอ — มติบอส PDPA ห้ามเก็บที่อยู่เต็ม/เลขบัตร/อายุ)
alter table cases add column if not exists citizen_district text;

-- 4) บันทึกการยื่นผ่านเว็บสำหรับนับเพดานต่อเครือข่าย — ip_hash = HMAC-SHA256(FORM_SECRET, ip|วันที่)
--    ไม่มี IP ดิบ และแฮชเปลี่ยนทุกวัน โค้ดลบแถวเก่าเกิน 2 วันทิ้งเองทุกครั้งที่บันทึก
create table if not exists appointment_web_log (
  id         bigint generated always as identity primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists appointment_web_log_hash_idx on appointment_web_log (ip_hash, created_at);
create index if not exists appointment_web_log_created_idx on appointment_web_log (created_at);
-- ปิด client-side access เหมือนทุกตาราง (เข้าถึงผ่าน service key ฝั่งเซิร์ฟเวอร์เท่านั้น)
alter table appointment_web_log enable row level security;

-- 5) index นับ "เรื่องจากเว็บวันนี้" (เพดานรวมต่อวัน — นับจาก uid ว่าง จึงใช้ได้ตั้งแต่ก่อนรันไฟล์นี้)
create index if not exists cases_web_appt_created_idx on cases (created_at)
  where case_type = 'appointment' and citizen_line_uid is null;

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย:
-- select column_name from information_schema.columns
--   where table_name = 'cases' and column_name in ('preferred_time', 'source', 'citizen_district');   -- ต้องได้ 3 แถว
-- select count(*) from appointment_web_log;                                                          -- ต้องไม่ error ═══
