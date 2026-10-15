-- supabase-migration-3-satisfaction.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนใช้ฟีเจอร์ "ให้คะแนนความพึงพอใจหลังปิดเรื่อง" ที่เพิ่ม 17 ก.ย. 69 — แนวคิดจาก Traffy Fondue
-- โค้ดฝั่งเซิร์ฟเวอร์กันไว้ไม่ให้ฟีเจอร์อื่นพังถ้ายังไม่ได้รันไฟล์นี้ แต่การขอคะแนนจะยังไม่ทำงานจนกว่าจะรัน)

alter table cases add column if not exists satisfaction_rating smallint check (satisfaction_rating between 1 and 5);
alter table cases add column if not exists satisfaction_rated_at timestamptz;

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='cases' and column_name in ('satisfaction_rating','satisfaction_rated_at'); ═══
