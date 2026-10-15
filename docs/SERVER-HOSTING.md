# คู่มือรับมอบโค้ดและติดตั้งเว็บไซต์ศูนย์ช่วยเหลือฯ

อัปเดต 15 ตุลาคม 2569

## ดาวน์โหลดและอัปเดต

ต้นทางโค้ด: https://github.com/peoplelawcenter/suphan-legalaid-public

ZIP เวอร์ชันล่าสุดของสาขา master: https://github.com/peoplelawcenter/suphan-legalaid-public/archive/refs/heads/master.zip

บันทึกลิงก์เดิมไว้ใช้ได้ทุกครั้ง หลังผู้พัฒนา push เข้า master ให้ดาวน์โหลด ZIP ใหม่ หรือดึงด้วย Git ภายในโฟลเดอร์โค้ดที่ไม่มีการแก้ไขค้างอยู่:

```sh
git clone https://github.com/peoplelawcenter/suphan-legalaid-public.git
cd suphan-legalaid
git pull --ff-only origin master
npm ci
npm test
```

รีโปเผยแพร่สาธารณะดาวน์โหลดได้โดยไม่ต้องลงชื่อเข้าใช้ GitHub เมื่อผู้ดูแล push เวอร์ชันใหม่เข้า master ให้ดาวน์โหลด ZIP จากลิงก์เดิม หรือใช้ git pull --ff-only origin master การดาวน์โหลดไม่ได้อัปเดตเซิร์ฟเวอร์โดยอัตโนมัติ

## สิ่งที่ต้องทราบเกี่ยวกับเซิร์ฟเวอร์

ระบบปัจจุบันใช้ Node.js 24, Vercel Functions และ Supabase เว็บหน้าแรกสร้างจาก API `api/site.js` และอ่านเนื้อหาจากฐานข้อมูล ไม่มีคำสั่ง `npm start` หรือ Dockerfile สำหรับ production server ในเวอร์ชันนี้

| สภาพแวดล้อม | วิธีติดตั้งที่ต้องจัดเตรียม |
| --- | --- |
| Vercel | ใช้ configuration เดิมใน `vercel.json` และตั้ง Environment Variables ตาม SETUP-GUIDE.md |
| Node.js หรือ Docker บนเซิร์ฟเวอร์ อบจ. | ต้องเตรียม production HTTP adapter และ process manager/container รองรับ Vercel request/response API ก่อน โค้ดปัจจุบันยังไม่ใช่เซิร์ฟเวอร์ Node ที่สั่ง start ได้ทันที |
| โฮสต์ PHP/Apache อย่างเดียว | รัน API Node.js นี้โดยตรงไม่ได้ ต้องเพิ่มบริการ Node.js หรือใช้ backend host ที่รองรับแล้วเชื่อมกับโดเมน อบจ. |

ก่อนเลือกวิธี ให้ผู้ดูแลแจ้งระบบปฏิบัติการ เว็บเซิร์ฟเวอร์ เวอร์ชัน Node.js สิทธิ์ติดตั้งบริการ และโดเมนหรือ URL ปลายทาง

สคริปต์ `scripts/dev-site.mjs` ใช้ฐานข้อมูลจำลองสำหรับพัฒนาและทดสอบหน้าเว็บ ห้ามใช้เป็น production server

## การอยู่ภายใต้เว็บ อบจ.

แนะนำให้ประเมิน subdomain ที่หน่วยงานกำหนดเป็นตัวเลือกแรก เนื่องจากระบบใช้เส้นทางจากราก เช่น `/api/`, `/assets/`, `/news` และ `/staff.html`

หากต้องใช้ subpath เช่น `/peoplelawcenter/` ต้องปรับ base path, routing, redirect, asset URL, cookie path และ callback ของ OAuth ให้สอดคล้องกันก่อน จึงไม่ควรนำโค้ดไปวางในโฟลเดอร์ย่อยแล้วถือว่าติดตั้งเสร็จ

ฝั่ง production ต้องมี HTTPS และส่ง Host/Origin ผ่าน proxy ให้ถูกต้อง ระบบใช้คุกกี้ Secure และตรวจ same-origin ในบาง API ต้องนำ rewrites และ security headers จาก `vercel.json` ไปตั้งในแพลตฟอร์มใหม่ด้วย ไม่ให้ web server เปิดโฟลเดอร์โครงการทั้งหมดเป็น document root โดยตรง ให้เสิร์ฟไฟล์นิ่งเฉพาะ `public/` และส่ง API ไปยัง backend

## การตั้งค่าและฐานข้อมูล

ตั้งค่าฝั่งเซิร์ฟเวอร์ตาม `docs/SETUP-GUIDE.md` ตัวแปรสำคัญมี `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SITE_URL`, `STAFF_SECRET`, `FORM_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `MAIL_USER`, `MAIL_APP_PASSWORD` และค่าของ OAuth ที่เปิดใช้งาน

ตัวแปรเหล่านี้เป็นชื่อสำหรับตั้งค่าเท่านั้น ค่าจริงต้องรับมอบผ่านช่องทางที่หน่วยงานกำหนด ไม่ใส่ใน GitHub, ไฟล์หน้าเว็บ หรือ ZIP สาธารณะ

สำหรับฐานใหม่ รัน `supabase-setup.sql` และ migration ตามลำดับเลข สำหรับฐานที่ใช้งานอยู่ ตรวจว่า migration ใดรันแล้ว สำรองข้อมูล และรันเฉพาะส่วนที่ยังขาด เวอร์ชันนี้มี `supabase-migration-17-site-stats.sql` สำหรับสถิติการเข้าชม หากยังไม่รัน ตัวเลขสถิติจะไม่พร้อมใช้งาน

โค้ดกับฐานข้อมูลเป็นคนละส่วน การดาวน์โหลด ZIP ไม่ย้ายเรื่องร้องเรียน บัญชีเจ้าหน้าที่ รูปที่อัปโหลด หรือไฟล์หลักฐาน ต้องตกลงว่าจะใช้ Supabase เดิมหรือย้ายข้อมูลแยกต่างหากก่อนเปลี่ยน production

เมื่อเปลี่ยน URL ให้ตรวจ `SITE_URL`, LINE webhook และ OAuth callback ที่ใช้อยู่ ตั้งงานรายวันตาม `crons` ใน `vercel.json` บนระบบ scheduler ของโฮสต์ใหม่ด้วย

## ขั้นตอนอัปเดตเซิร์ฟเวอร์จริง

1. บันทึก commit/version ที่ใช้งานอยู่และสำรองการตั้งค่า ฐานข้อมูล และ Storage ที่จำเป็น
2. ดาวน์โหลดหรือ pull โค้ดใหม่ลงโฟลเดอร์รุ่นใหม่ ติดตั้ง dependencies ด้วย `npm ci` และรัน `npm test`
3. ตรวจและรัน migration ที่จำเป็นตามรายการที่ยังขาด ทดสอบบน staging ก่อน
4. ตั้งค่า environment และทดสอบหน้าเว็บ การเข้าสู่ระบบ CMS การรับเรื่อง การอัปโหลด และ routing ด้วยบัญชีทดสอบ
5. เมื่อได้รับอนุมัติ จึงสลับบริการไปเวอร์ชันใหม่ หากมีปัญหา สลับกลับโค้ดเวอร์ชันก่อน และประเมินความเข้ากันได้กับ schema ก่อนย้อนฐานข้อมูล

## เอกสารอ้างอิง

- [GitHub: ดาวน์โหลด source archive](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)
- [GitHub: deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
- [GitHub: สิทธิ์ collaborator ในรีโปส่วนบุคคล](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)
