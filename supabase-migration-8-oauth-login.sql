-- supabase-migration-8-oauth-login.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้
-- (จำเป็นก่อนปุ่ม "เข้าสู่ระบบด้วย Google/Facebook" ใช้งานได้จริง — เพิ่ม 18 ก.ย. 69)
-- LINE ไม่ต้องเพิ่มคอลัมน์ใหม่ — ใช้ staff.line_uid เดิมจาก migration-7 (คอลัมน์เดียวกับที่ "เชื่อมบัญชี
-- LINE" ในหน้าโปรไฟล์เขียนอยู่แล้ว) ดู CLAUDE.md หัวข้อ "ล็อกอินหลายช่องทาง" สำหรับเหตุผลเต็ม

alter table staff add column if not exists google_sub text;
alter table staff add column if not exists facebook_id text;

-- unique ป้องกันบัญชี Google/Facebook เดียวผูกกับเจ้าหน้าที่ 2 คนพร้อมกัน (where ... is not null กันชน
-- กับแถวที่ยังไม่เคยเชื่อม ซึ่งมีค่า null ได้หลายแถว — แบบเดียวกับ staff_email_unique_idx ใน migration-7)
create unique index if not exists staff_google_sub_unique_idx on staff (google_sub) where google_sub is not null;
create unique index if not exists staff_facebook_id_unique_idx on staff (facebook_id) where facebook_id is not null;

-- เสร็จแล้ว — ตรวจว่าครบด้วย: select column_name from information_schema.columns
-- where table_name='staff' and column_name in ('google_sub','facebook_id');
