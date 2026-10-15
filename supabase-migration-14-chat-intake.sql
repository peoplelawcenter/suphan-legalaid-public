-- supabase-migration-14-chat-intake.sql — รันใน Supabase SQL Editor ของโปรเจกต์ศูนย์ฯ (ไม่ใช่สำนักปลัด)
-- เพิ่ม 2 ต.ค. 69: "รับเรื่องทางแชต" — บอสสั่ง "เวลาประชาชนพิมพ์ text มาให้รับเรื่องได้ด้วย ไม่จำเป็นต้องกรอกแบบฟอร์มอย่างเดียว"
-- (มติบอส: เล่าอิสระ แล้วกดยืนยัน — พิมพ์/แนบรูป-PDF กี่ครั้งก็ได้ บอทรวบเป็นร่าง → กดส่ง → ได้เลขที่เรื่อง)
-- ต้องรันหลัง supabase-migration-12-appointment-web.sql (คอลัมน์ cases.source)
--
-- ✅ idempotent ทุกบรรทัด — รันซ้ำกี่รอบก็ได้ผลเท่าเดิม ไม่ลบข้อมูลใด
-- ✅ ยังไม่รันไฟล์นี้ ระบบเดิมไม่พัง: ไม่มีตาราง chat_drafts = บอทตอบการ์ด "ได้รับข้อความแล้ว" ชี้ไปแบบฟอร์มแบบเดิม
--    (api/_chatintake.js ตรวจ PGRST205/42P01 แล้วถอยเอง) · ยังไม่ขยาย check ของ cases.source = เรื่องจากแชต
--    บันทึกเป็น 'line' + ต่อท้ายรายละเอียด "[ช่องทาง: แจ้งทางแชตไลน์]" แทน (api/_cases.js createCase)

-- 1) ร่างเรื่องที่ประชาชนเล่าในแชต — 1 แถวต่อผู้ใช้ไลน์ 1 คน
--    items          รายการตามลำดับเวลา [{t:'text'|'file'|'location'|'note', at, text?, path?, name?, kind?}]
--    evidence_paths ไฟล์ใน bucket evidence ที่ยังเป็นของร่าง (ยังไม่เข้าเรื่อง) — ⛔ ส่งเรื่องแล้วโค้ดล้างทันที
--    inflight       ร่างที่กำลังบันทึกเป็นเรื่อง (ย้ายออกจาก items ตอนกดส่ง — กันกดซ้ำ/ข้อความที่พิมพ์ระหว่างส่งไม่หาย)
--    rev            เลขรุ่นของแถว ใช้แก้แบบ compare-and-swap (ข้อความ/รูปหลายชิ้นเข้ามาพร้อมกันคนละอินสแตนซ์ต้องไม่ทับกัน)
--    awaiting       'phone' = กำลังรอผู้แจ้งพิมพ์เบอร์โทร · pending_type = ประเภทเรื่องที่กดส่งไว้ระหว่างรอเบอร์
--    submitted_at   ตั้งตอนกดส่ง (atomic: update … where submitted_at is null) · last_case_no = เลขที่เรื่องล่าสุดจากแชต
create table if not exists chat_drafts (
  line_uid        text primary key,
  items           jsonb not null default '[]'::jsonb,
  evidence_paths  text[] not null default '{}',
  inflight        jsonb,
  rev             integer not null default 0,
  awaiting        text,
  pending_type    text,
  phone           text,
  last_case_no    text,
  submitted_at    timestamptz,
  phone_nudged_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table chat_drafts drop constraint if exists chat_drafts_awaiting_check;
alter table chat_drafts add constraint chat_drafts_awaiting_check check (awaiting is null or awaiting in ('phone'));
alter table chat_drafts drop constraint if exists chat_drafts_pending_type_check;
alter table chat_drafts add constraint chat_drafts_pending_type_check
  check (pending_type is null or pending_type in ('consult', 'complaint', 'appointment'));
-- cron รายวัน (api/cron-notify.js) ลบร่างที่ค้างเกิน 24 ชม. + ไฟล์ของร่าง · แถวที่ส่งแล้วเก่ากว่า 2 วันลบทิ้ง
create index if not exists chat_drafts_updated_idx on chat_drafts (updated_at);
-- ปิด client-side access เหมือนทุกตาราง (เข้าถึงผ่าน service key ฝั่งเซิร์ฟเวอร์เท่านั้น — ไม่มี policy)
alter table chat_drafts enable row level security;

-- 2) ช่องทางที่ยื่นเรื่องเพิ่ม 'chat' (พิมพ์เล่าในแชตไลน์แล้วกดส่ง ไม่ได้กรอกแบบฟอร์ม)
alter table cases drop constraint if exists cases_source_check;
alter table cases add constraint cases_source_check check (source in ('line', 'web', 'chat'));
-- เรื่องจากแชตที่เข้ามาก่อนรันไฟล์นี้ (บันทึกเป็น 'line' + ป้ายในรายละเอียด) แก้ช่องทางให้ถูก — รันซ้ำไม่มีผลเพิ่ม
update cases set source = 'chat'
  where source = 'line' and detail like '%[ช่องทาง: แจ้งทางแชตไลน์]%';

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย:
-- select count(*) from chat_drafts;                                                              -- ต้องไม่ error
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'cases_source_check';     -- ต้องมี 'chat' ═══
