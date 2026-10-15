-- supabase-migration-5-notify-categories.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนฟีเจอร์ "รับแจ้งเตือนเฉพาะบางหมวด" ที่เพิ่ม 17 ก.ย. 69 — แนวคิดจาก Traffy Fondue
-- "ตั้งค่าการแจ้งเตือน" ต่อหมวด — โค้ดฝั่งเซิร์ฟเวอร์ (notifiableStaff ใน api/_staffauth.js) มี fallback
-- ให้ทุกคนรับแจ้งเตือนทุกหมวดเหมือนเดิมถ้ายังไม่ได้รันไฟล์นี้ ไม่พังอะไรทั้งนั้น)

-- null/'{}' = รับแจ้งเตือนทุกหมวด (ค่าเริ่มต้น ไม่กระทบเจ้าหน้าที่ที่มีอยู่แล้วเลย)
-- ไม่ null = รับเฉพาะหมวดที่อยู่ในอาเรย์ (scam/debt/inheritance/labor/divorce/land/criminal/other)
alter table staff add column if not exists notify_categories text[];

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='staff' and column_name='notify_categories'; ═══
