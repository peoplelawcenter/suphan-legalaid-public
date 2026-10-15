-- supabase-migration-16-staff-avatar.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- เพิ่มคอลัมน์ "รูปโปรไฟล์เจ้าหน้าที่" (7 ต.ค. 69 — บอสสั่งปรับหลังบ้านตามภาพต้นแบบ Traffy Fondue: เจ้าหน้าที่เปลี่ยนรูปโปรไฟล์เองได้)
-- เก็บเป็น data URL ของ JPEG ที่หน้าเว็บย่อ/ครอปเป็นสี่เหลี่ยมจัตุรัส 256×256 แล้ว (ราว 10–30 KB) ในแถว staff เอง
-- ไม่ใช้ Storage bucket: ไม่ต้องสร้าง bucket/นโยบายเพิ่ม ไม่มีลิงก์สาธารณะ (ภาพอยู่ในแถว staff ซึ่งเปิด RLS ไว้ อ่านได้ผ่าน
-- API หลังบ้านที่ล็อกอินแล้วเท่านั้น) และไม่ต้องออก signed URL ทุกครั้งที่เปิดหน้า — ตามหลักเดียวกับรูปบุคลากรที่ไม่เปิดสาธารณะ
-- เพดานฝั่งฐาน: ขึ้นต้น data:image/jpeg;base64, และยาวไม่เกิน 120,000 ตัวอักษร (ฝั่งเซิร์ฟเวอร์ api/_avatar.js ตรวจละเอียดกว่านี้
-- อีกชั้น: หัวไฟล์ JPEG จริง · ≤ 80 KB · กว้าง/สูง 64–512 px)
-- โค้ดกันไว้ไม่ให้หลังบ้านพังถ้ายังไม่ได้รัน (api/staff.js action=me ใช้ select * → ไม่มีคอลัมน์ = ไม่มีรูป ใช้ตัวอักษรย่อแทน)
-- แค่ปุ่ม "เปลี่ยนรูปโปรไฟล์" จะแจ้งให้ผู้ดูแลระบบรัน migration นี้ก่อน
alter table staff add column if not exists avatar_data text;
alter table staff drop constraint if exists staff_avatar_data_check;
alter table staff add constraint staff_avatar_data_check
  check (avatar_data is null or (avatar_data like 'data:image/jpeg;base64,%' and length(avatar_data) <= 120000));
