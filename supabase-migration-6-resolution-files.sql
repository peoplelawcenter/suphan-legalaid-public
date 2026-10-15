-- supabase-migration-6-resolution-files.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนฟีเจอร์ "แนบเอกสาร/รูปผลการดำเนินการตอนปิดเรื่อง" ที่เพิ่ม 17 ก.ย. 69 — แนวคิดจาก
-- Traffy Fondue "รูปภาพดำเนินการ" — ถ้ายังไม่ได้รันไฟล์นี้ ปุ่มแนบเอกสารผลดำเนินการในหลังบ้านจะขึ้น error
-- ชัดเจน "column not found" ไม่กระทบฟีเจอร์อื่นเลย)

-- เก็บแยกจาก evidence_paths โดยตั้งใจ (evidence_paths = หลักฐานจากประชาชน, resolution_paths = เอกสาร/
-- รูปที่เจ้าหน้าที่แนบให้ประชาชนดู) ใช้บัคเก็ต Storage "evidence" เดียวกัน แค่คนละคอลัมน์อ้างอิง
alter table cases add column if not exists resolution_paths text[] not null default '{}';

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='cases' and column_name='resolution_paths'; ═══
