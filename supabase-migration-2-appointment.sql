-- supabase-migration-2-appointment.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนใช้ฟีเจอร์ "จองคิวทนายอาสา" แบบง่าย ที่เพิ่ม 17 ก.ย. 69 — โค้ดฝั่งเซิร์ฟเวอร์กันไว้แล้วไม่ให้
-- ฟีเจอร์เดิม (ปรึกษา/ร้องเรียน) พังถ้ายังไม่ได้รันไฟล์นี้ แต่ปุ่ม "จองคิวทนายอาสา" จะยังใช้งานจริงไม่ได้
-- จนกว่าจะรันไฟล์นี้ก่อน)

-- 1) เพิ่ม 'appointment' เข้าไปในชนิดเรื่องที่อนุญาต
alter table cases drop constraint if exists cases_case_type_check;
alter table cases add constraint cases_case_type_check check (case_type in ('consult', 'complaint', 'appointment'));

-- 2) คอลัมน์วัน-เวลาที่ต้องการนัดหมาย (ใช้เฉพาะ case_type='appointment' ปล่อยว่างสำหรับเรื่องประเภทอื่น)
alter table cases add column if not exists preferred_date date;
alter table cases add column if not exists preferred_time_slot text check (preferred_time_slot in ('morning', 'afternoon'));

-- ═══ เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='cases' and column_name in ('preferred_date','preferred_time_slot'); ═══
