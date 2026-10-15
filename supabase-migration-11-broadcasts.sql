-- supabase-migration-11-broadcasts.sql — รันครั้งเดียวใน Supabase SQL Editor ของโปรเจกต์นี้ (รันซ้ำได้ปลอดภัย)
-- ประวัติการส่งโปสเตอร์ข่าว ปชส. ถึงเพื่อนทุกคนของ LINE OA จากหน้าเว็บ broadcast.html (เพิ่ม 24 ก.ย. 69)
-- ยังไม่รัน = ส่งประกาศได้ปกติทุกอย่าง แค่หน้าเว็บจะไม่มี "ประวัติการส่ง" ให้ดู (ดู api/_broadcast.js)

create table if not exists broadcasts (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  staff_id        bigint references staff(id) on delete set null,
  staff_name      text,
  mode            text not null check (mode in ('all', 'test')),   -- all = ถึงเพื่อนทุกคน · test = ส่งทดสอบเข้าไลน์ตัวเอง
  image_urls      jsonb not null default '[]'::jsonb,
  caption         text,
  link            text,
  notify          boolean not null default true,                    -- false = ส่งแบบไม่มีเสียงแจ้งเตือน
  status          text not null check (status in ('sent', 'failed')),
  error           text,
  retry_key       text,                                             -- X-Line-Retry-Key กันส่งซ้ำ
  line_request_id text,
  est_recipients  int,                                              -- ประมาณการจากสถิติเพื่อนของไลน์ (เพื่อน − บล็อก)
  quota_before    int                                               -- โควตาคงเหลือก่อนส่ง
);
create index if not exists broadcasts_created_idx on broadcasts (created_at desc);
create index if not exists broadcasts_retry_key_idx on broadcasts (retry_key);

-- ปิด client-side access เหมือนทุกตาราง — อ่าน/เขียนผ่าน service key จากเซิร์ฟเวอร์เท่านั้น
alter table broadcasts enable row level security;

-- ที่เก็บรูปโปสเตอร์ (public — ไลน์ต้องโหลดรูปจากลิงก์ได้ตรงๆ ตอนผู้รับเปิดดู) โค้ดสร้างให้เองอัตโนมัติ
-- ครั้งแรกที่กดอัปโหลดอยู่แล้ว บรรทัดนี้มีไว้เผื่อสร้างล่วงหน้า/ตรวจสอบเท่านั้น ห้ามใส่ไฟล์ลับใน bucket นี้
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- ตรวจว่าครบ: select count(*) from broadcasts;  select id, public from storage.buckets where id = 'posters';
