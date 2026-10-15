-- supabase-migration-4-withdraw-status.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนฟีเจอร์ "ยกเลิกเรื่องเอง" ที่เพิ่ม 17 ก.ย. 69 — แนวคิดจาก Traffy Fondue ปุ่ม "ยกเลิกเรื่อง"
-- โค้ดฝั่งเซิร์ฟเวอร์ (updateStatus ใน api/_cases.js) จะปฏิเสธการตั้งสถานะ 'withdrawn' ด้วย error ชัดเจน
-- ถ้ายังไม่ได้รันไฟล์นี้ — ไม่กระทบฟีเจอร์อื่นเลยถ้ายังไม่ได้รัน แค่ปุ่ม "ยกเลิกเรื่องนี้" ในไลน์จะใช้ไม่ได้)

alter table cases drop constraint if exists cases_status_check;
alter table cases add constraint cases_status_check
  check (status in ('new','assigned','in_progress','need_info','closed','withdrawn'));

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conname = 'cases_status_check'; ต้องเห็น 'withdrawn' อยู่ในรายการด้วย ═══
