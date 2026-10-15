# คู่มือสมัคร/ตั้งค่า — LINE OA ศูนย์ช่วยเหลือประชาชนทางกฎหมาย

ทำตามลำดับนี้ (ข้ามไม่ได้ บางขั้นตอนต้องมีของจากขั้นก่อนหน้า) — ทุกขั้นตอนที่ต้อง "ล็อกอินเอง" ต้องทำ
ด้วยบัญชี **`peoplelaw.center@gmail.com`** เท่านั้น (ไม่ใช่บัญชีส่วนตัว ไม่ใช่ sppaosuphanburi ของระบบ
สำนักปลัด — ระบบนี้แยกขาดกันโดยสิ้นเชิงตามที่สั่งไว้)

---

## ขั้นที่ 1 — สร้าง LINE Official Account

1. เปิด https://manager.line.biz เข้าสู่ระบบด้วย `peoplelaw.center@gmail.com` (สมัคร LINE Business ID
   ใหม่ถ้ายังไม่มี — ใช้อีเมลนี้สมัคร)
2. กด "สร้างบัญชี" เลือกหมวดหมู่ "หน่วยงานราชการ/องค์กรไม่แสวงหาผลกำไร"
3. ตั้งชื่อบัญชี: **ศูนย์ช่วยเหลือประชาชนทางกฎหมาย** (หรือชื่อที่สั้นกว่าถ้าระบบไม่ให้ยาวขนาดนี้)
4. อัปโหลดรูปโปรไฟล์ (แนะนำใช้โลโก้ อบจ. หรือโลโก้คู่ที่มีอยู่ในโฟลเดอร์งาน)
5. **บันทึก LINE Official Account ID** (รูปแบบ `@073kbdgu`) ไว้ — ใช้หา QR code แจกประชาสัมพันธ์ต่อไป

## ขั้นที่ 2 — เปิด Messaging API

1. ใน manager.line.biz ไปที่ **ตั้งค่า > Messaging API** กด "เปิดใช้ Messaging API"
2. จะถูกพาไปสร้าง **Provider** ใหม่ (ตั้งชื่อ Provider เช่น "อบจ.สุพรรณบุรี" — ใช้ Provider เดิมไม่ได้
   เพราะ Provider ผูกกับ LINE Developers Console ของบัญชีอื่นอยู่)
3. หลังเปิดสำเร็จ ไปที่ **LINE Developers Console** (https://developers.line.biz) เข้าสู่ระบบด้วยบัญชี
   เดียวกัน → เลือก Provider → เลือก Channel ของ Messaging API ที่สร้างไว้
4. ในหน้า Channel: แท็บ **Basic settings** → คัดลอก **Channel secret** เก็บไว้ (ใช้เป็น
   `LINE_CHANNEL_SECRET`)
5. แท็บ **Messaging API** → เลื่อนหา "Channel access token" → กด "Issue" → คัดลอกเก็บไว้ (ใช้เป็น
   `LINE_CHANNEL_ACCESS_TOKEN`) — **โทเคนนี้เห็นครั้งเดียว ถ้าพลาดต้อง Issue ใหม่**
6. ในหน้าเดียวกัน: **ปิด** "Auto-reply messages" และ "Greeting messages" ที่เป็นของ LINE เอง (ระบบเรา
   จะส่งข้อความต้อนรับ/ตอบกลับด้วยโค้ดเอง ถ้าเปิดพร้อมกันข้อความจะซ้อนกัน 2 ชุด)
7. **เปิด** "Use webhook" (ยังไส่ URL ไม่ได้จนกว่าจะ deploy เสร็จ — กลับมาทำขั้นที่ 6 ทีหลัง)

## ขั้นที่ 3 — สร้างบัญชี Vercel

1. เปิด https://vercel.com/signup สมัคร/ล็อกอินด้วย `peoplelaw.center@gmail.com`
2. แนะนำเชื่อมกับ GitHub (สมัคร GitHub ใหม่ด้วยอีเมลเดียวกัน ตั้ง repo เป็น **private** เพราะมีข้อมูล
   ประชาชนไหลผ่าน) — หรือจะ deploy ด้วย Vercel CLI จากเครื่องที่มีโค้ดนี้ก็ได้โดยไม่ต้องพึ่ง GitHub
3. ไม่ต้องผูกบัตรเครดิต ใช้แพลน **Hobby (ฟรี)** พอสำหรับระบบนี้

## ขั้นที่ 4 — สร้างโปรเจกต์ Supabase

1. เปิด https://supabase.com/dashboard สมัคร/ล็อกอินด้วย `peoplelaw.center@gmail.com`
2. สร้างโปรเจกต์ใหม่ ตั้งชื่อ เช่น "legalaid-suphanburi" เลือก region ใกล้ไทยที่สุด (Singapore)
   ตั้งรหัสผ่านฐานข้อมูล (เก็บไว้ ไม่ใช้บ่อยแต่บางทีต้องใช้)
3. รอโปรเจกต์สร้างเสร็จ (1-2 นาที) → ไปที่ **SQL Editor** → New query → **วางเนื้อหาทั้งหมดของไฟล์
   `supabase-setup.sql`** ในโปรเจกต์นี้ → กด Run → **จากนั้นรันไฟล์ `supabase-migration-2-*.sql` ถึง
   `supabase-migration-8-*.sql` ตามลำดับเลขทีละไฟล์ด้วย** (แต่ละไฟล์ New query แยก กด Run แล้วค่อยไปไฟล์
   ถัดไป — ขาดไฟล์ไหนไปฟีเจอร์ที่ไฟล์นั้นดูแลจะใช้ไม่ได้ โดยเฉพาะ `supabase-migration-7-staff-accounts.sql`
   ที่ระบบล็อกอินเจ้าหน้าที่ทั้งหมดต้องพึ่ง — ดูขั้นที่ 7 — และ `supabase-migration-8-oauth-login.sql`
   ที่ปุ่ม "เข้าสู่ระบบด้วย Google/Facebook" ต้องพึ่ง — ดูขั้นที่ 10 ไม่บังคับ)
4. ไปที่ **Project Settings > API** → คัดลอก:
   - **Project URL** → ใช้เป็น `SUPABASE_URL`
   - **anon public key** → ใช้เป็น `SUPABASE_ANON_KEY` (เปิดเผยได้ ไม่ใช่ความลับ)
   - **service_role key** → ใช้เป็น `SUPABASE_SERVICE_KEY` (⚠️ ความลับสูงสุด ห้ามเผยแพร่/วางในโค้ด
     ฝั่งเว็บเด็ดขาด)

## ขั้นที่ 5 — ตั้งค่าอีเมล (Gmail App Password) — ⚠️⚠️ บังคับ ข้ามไม่ได้ (เปลี่ยนตั้งแต่ 17 ก.ย. 69 รอบ 3)
เดิมขั้นนี้เป็นแค่ช่องทางแจ้งเตือนสำรอง แต่ตอนนี้ระบบล็อกอินเจ้าหน้าที่ทั้งหมดต้องส่ง OTP ยืนยันอีเมล
**ถ้าข้ามขั้นนี้ เจ้าหน้าที่คนแรก (รวมถึงบอสเอง) จะสมัครสมาชิกเข้าระบบไม่ได้เลย** ต้องทำก่อนขั้นที่ 7

1. ล็อกอิน Gmail ด้วย `peoplelaw.center@gmail.com` → เปิดการยืนยัน 2 ขั้นตอนก่อน (ถ้ายังไม่เปิด)
2. ไปที่ https://myaccount.google.com/apppasswords → สร้าง App password ใหม่ ตั้งชื่อ "LegalAid System"
3. คัดลอกรหัส 16 ตัวที่ได้ (ไม่มีเว้นวรรค) → ใช้เป็น `MAIL_APP_PASSWORD`
4. `MAIL_USER` = `peoplelaw.center@gmail.com`

## ขั้นที่ 6 — Deploy ขึ้น Vercel + ตั้ง Environment Variables

ให้ทีมเทคนิค (หรือผม) รันคำสั่งนี้จากเครื่องที่มีโค้ด:
```
npm install
npm test
npx vercel login          # ล็อกอินด้วย peoplelaw.center@gmail.com
npx vercel link           # เชื่อมกับโปรเจกต์ Vercel ที่สร้างไว้ขั้นที่ 3
```
จากนั้นตั้งค่า Environment Variables ในหน้า Vercel Dashboard (Project → Settings → Environment
Variables) ให้ครบทุกตัว (ตั้งเป็น **Sensitive** สำหรับตัวที่มาร์ค 🔒):

| ชื่อตัวแปร | ค่า | หมายเหตุ |
|---|---|---|
| `LINE_CHANNEL_SECRET` 🔒 | จากขั้นที่ 2.4 | |
| `LINE_CHANNEL_ACCESS_TOKEN` 🔒 | จากขั้นที่ 2.5 | |
| `SUPABASE_URL` | จากขั้นที่ 4.4 | ไม่ลับ |
| `SUPABASE_ANON_KEY` | จากขั้นที่ 4.4 | ไม่ลับ (ฝังในหน้าเว็บได้) |
| `SUPABASE_SERVICE_KEY` 🔒 | จากขั้นที่ 4.4 | ห้ามหลุดเด็ดขาด |
| `MAIL_USER` | `peoplelaw.center@gmail.com` | |
| `MAIL_APP_PASSWORD` 🔒 | จากขั้นที่ 5.3 | |
| `SITE_URL` | `https://<โดเมนที่ Vercel ให้>` | ตั้งหลัง deploy ครั้งแรกแล้วรู้โดเมน |
| `SEED_ADMIN_EMAIL` | อีเมลที่แอดมินคนแรกจะใช้สมัคร | ดูขั้นที่ 7 (17 ก.ย. 69 รอบ 3 — แทน `SEED_ADMIN_LINE_UID` เดิม) |
| `SETUP_TOKEN` 🔒 | ตั้งเอง (สุ่มยาวๆ) | ใช้ตั้ง Rich Menu |
| `HEALTH_TOKEN` 🔒 | ตั้งเอง (สุ่มยาวๆ) | ใช้เช็คสุขภาพระบบ |
| `CRON_SECRET` 🔒 | ตั้งเอง (สุ่มยาวๆ) | Vercel ใส่ให้เองอัตโนมัติตอน trigger cron |
| `FORM_SECRET` 🔒 | ตั้งเอง (สุ่มยาวๆ) | ถ้าไม่ตั้งจะใช้ LINE_CHANNEL_ACCESS_TOKEN แทน |
| `STAFF_SECRET` 🔒 | ตั้งเอง (สุ่มยาวๆ) | เหมือนข้างบน คนละกุญแจกัน |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 🔒 | จากขั้นที่ 10.1 | ไม่บังคับ — ไม่ตั้งก็ใช้ระบบได้ปกติ ปุ่ม "เข้าสู่ระบบด้วย Google" แค่จะกดแล้วบอกว่ายังไม่เปิดใช้งาน |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` 🔒 | จากขั้นที่ 10.2 | ไม่บังคับเช่นกัน |
| `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` 🔒 | จากขั้นที่ 10.3 | ไม่บังคับเช่นกัน — **คนละตัวกับ `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN` เดิม** (Messaging API คนละ channel type กับ LINE Login) |

ตั้งครบแล้ว deploy จริง:
```
npx vercel --prod --yes
```

## ขั้นที่ 7 — สมัครแอดมินคนแรก (เว็บ — เปลี่ยนทั้งขั้นตอน 17 ก.ย. 69 รอบ 3)
**⚠️ ต้องรัน `supabase-migration-7-staff-accounts.sql` ก่อนขั้นนี้เสมอ** (ดูขั้นที่ 4 — รันทุกไฟล์
`supabase-migration-*.sql` ตามลำดับเลขให้ครบก่อน ไม่ใช่แค่ `supabase-setup.sql` อันเดียว)

1. เอาโดเมนที่ deploy ได้ (`SITE_URL`) ไปตั้งเป็น env var `SITE_URL` แล้ว deploy ซ้ำอีกครั้ง (ต้องรู้
   โดเมนก่อนตั้งค่านี้ได้)
2. ตั้ง webhook URL ใน LINE Developers Console (ขั้นที่ 2.7 ที่ค้างไว้): `https://<โดเมน>/api/line-webhook`
   กด Verify ต้องได้ "Success" (ยังต้องมีขั้นนี้อยู่ — ฝั่งประชาชนยังใช้ LINE OA ปกติ แค่เจ้าหน้าที่ไม่ใช้)
3. ตัดสินใจว่าจะให้อีเมลไหนเป็นแอดมินคนแรก → ตั้งเป็น env var `SEED_ADMIN_EMAIL` บน Vercel แล้ว deploy
   อีกครั้ง (ครั้งเดียวพอ)
4. เปิด `https://<โดเมน>/staff-register.html` สมัครสมาชิกด้วยอีเมลที่ตั้งไว้ในขั้นที่ 3 → เช็คอีเมลรับ
   รหัส OTP 6 หลัก (ถ้าไม่ได้รับ เช็คว่าทำขั้นที่ 5 ครบหรือยัง) → กรอกยืนยัน
5. ถ้าอีเมลตรงกับ `SEED_ADMIN_EMAIL` และยังไม่เคยมีแอดมินคนอื่นมาก่อน ระบบจะตั้ง role=admin ให้อัตโนมัติ
   ทันที (หน้าเว็บจะบอก "ได้รับสิทธิ์ผู้ดูแลระบบโดยอัตโนมัติ") ไม่ต้องรออนุมัติ
6. เข้าสู่ระบบที่ `staff-login.html` ด้วยอีเมล+รหัสผ่านที่ตั้งไว้ → ทดสอบเปิดแท็บ "เจ้าหน้าที่" ต้องเห็น
   ชื่อตัวเองในรายชื่อ role admin

## ขั้นที่ 8 — ตั้ง Rich Menu

1. เปิดเบราว์เซอร์ไปที่ `https://<โดเมน>/api/richmenu-setup?token=<SETUP_TOKEN>`
2. ต้องเห็นข้อความ "ตั้ง Rich Menu สำเร็จ" → กลับไปที่แชตไลน์ ต้องเห็นเมนู 6 ปุ่มที่ก้นแชต

## ขั้นที่ 9 — เพิ่มเจ้าหน้าที่คนอื่น + ทดสอบจริง (เปลี่ยนทั้งขั้นตอน 17 ก.ย. 69 รอบ 3)

1. ให้เจ้าหน้าที่แต่ละคนเปิด `https://<โดเมน>/staff-register.html` สมัครสมาชิกด้วยอีเมลตัวเอง (คนละอีเมล
   กับ `SEED_ADMIN_EMAIL`) → ยืนยัน OTP ที่ได้รับทางอีเมล
2. แอดมิน (ที่ทำขั้นที่ 7) เข้า `staff.html` แท็บ "เจ้าหน้าที่" > "คำขอสมัครสมาชิก" จะเห็นรายชื่อรออนุมัติ
   → กดอนุมัติ (ระบบจะส่งอีเมลแจ้งผู้สมัครอัตโนมัติถ้าเปิด `notify_email` ไว้)
3. เจ้าหน้าที่ที่ได้รับอนุมัติแล้วเข้าสู่ระบบที่ `staff-login.html` ด้วยอีเมล+รหัสผ่านที่ตั้งไว้ตอนสมัคร
   ทดสอบเปิดหน้าจัดการเรื่องต้องเข้าได้
4. (ไม่บังคับ) ถ้าอยากรับแจ้งเตือนเรื่องใหม่/เร่งด่วนผ่าน LINE เพิ่มจากอีเมล — ไปแท็บ "โปรไฟล์/ตั้งค่า"
   กด "สร้างรหัสเชื่อมบัญชี LINE" แล้วพิมพ์ `#เชื่อม <รหัส>` ในแชต LINE OA ของศูนย์ภายใน 10 นาที
5. ทดสอบส่งฟอร์มจริง 1 รอบ (กดปุ่ม "ปรึกษาข้อกฎหมาย" ในเมนู LINE กรอกฟอร์ม กดส่ง) ต้องได้เลขที่เรื่อง +
   มีการแจ้งเตือนเข้าอีเมลของเจ้าหน้าที่ที่เปิด `notify_email` ไว้ (และเข้า LINE ด้วยถ้าเชื่อมบัญชีตามข้อ 4)

## ขั้นที่ 10 (ไม่บังคับ) — เปิดใช้ "เข้าสู่ระบบด้วย Google/Facebook/LINE" (เพิ่ม 18 ก.ย. 69)
หน้า `staff-login.html` มีปุ่ม 3 ช่องทางนี้อยู่แล้วเสมอ (โชว์ตลอด ไม่ซ่อน) — ถ้ายังไม่ทำขั้นนี้ กดแล้วจะ
เด้งกลับมาพร้อมข้อความ "ยังไม่เปิดใช้งาน" เฉยๆ ไม่กระทบการเข้าสู่ระบบด้วยอีเมล/รหัสผ่านเดิมเลย — ทำทีละ
ช่องทางได้ ไม่ต้องทำครบ 3 พร้อมกัน ทั้งหมดฟรีไม่มีค่าใช้จ่าย

**redirect URI ที่ต้องใช้ตั้งค่าในคอนโซลของแต่ละเจ้า (ตัวแปร `<โดเมน>` = ค่าเดียวกับ `SITE_URL` ขั้นที่ 6):**
```
https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=google
https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=facebook
https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=line
```
ต้องวางให้ตรงเป๊ะทุกตัวอักษร (รวม `?`/`&`) — พิมพ์ผิด/สะกดต่างจะโดนผู้ให้บริการปฏิเสธเงียบๆ หรือ error
"redirect_uri_mismatch"

### 10.1 Google — สร้าง OAuth Client
1. เปิด https://console.cloud.google.com เข้าสู่ระบบด้วย `peoplelaw.center@gmail.com` → สร้างโปรเจกต์ใหม่
   (เช่น "suphan-legalaid")
2. เมนูซ้าย **APIs & Services > OAuth consent screen** → เลือก User type "External" → กรอกชื่อแอป
   ("ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี"), อีเมลติดต่อ = `peoplelaw.center@gmail.com` →
   บันทึก (ไม่ต้องขอ verify จาก Google — scope ที่ใช้ email/profile เป็น non-sensitive ไม่บังคับตรวจสอบ)
   → ตั้งสถานะเป็น **In production** (ไม่ใช่ Testing ซึ่งจำกัดผู้ใช้ได้แค่ 100 คนที่เพิ่มชื่อไว้เอง)
3. เมนูซ้าย **APIs & Services > Credentials** → Create Credentials > OAuth client ID → Application type
   "Web application" → ชื่ออะไรก็ได้
4. **Authorized redirect URIs** → วาง `https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=google`
   ตามด้านบน → Create
5. คัดลอก **Client ID** และ **Client secret** ที่ได้ → ตั้งเป็น env var `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` บน Vercel → deploy ซ้ำ 1 ครั้ง

### 10.2 Facebook — สร้าง Facebook App
1. เปิด https://developers.facebook.com เข้าสู่ระบบด้วยบัญชี Facebook ที่จะดูแลระบบนี้ (Facebook ไม่มี
   "บัญชีองค์กร" แบบ Google/LINE — ต้องผูกกับบัญชีบุคคลจริงที่เป็นผู้ดูแลแอป)
2. My Apps > Create App → เลือกประเภท "Consumer" หรือ "None/อื่นๆ" (ไม่ใช่ธุรกิจ/โฆษณา) → ตั้งชื่อแอป
3. เพิ่มผลิตภัณฑ์ **Facebook Login** > Set Up → เลือก "Web" → ใส่ Site URL = `https://<โดเมน>`
4. เมนูซ้าย **Facebook Login > Settings** → **Valid OAuth Redirect URIs** → วาง
   `https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=facebook` ตามด้านบน → Save
5. เมนูซ้าย **App Review > Permissions and Features** ตรวจว่า `public_profile` และ `email` ขึ้นสถานะ
   "Ready for testing" หรือเขียวอยู่แล้ว (ปกติได้มาให้อัตโนมัติ ไม่ต้องยื่นขอเพิ่ม)
6. มุมขวาบนสลับ **App Mode จาก Development → Live** (ตอน Development เจ้าหน้าที่คนอื่นนอกจากผู้ดูแลแอป
   จะล็อกอินไม่ได้เลย ต้อง Live ก่อนคนอื่นถึงใช้ได้จริง) — Facebook อาจขอให้กรอกนโยบายความเป็นส่วนตัว/
   หมวดหมู่ธุรกิจก่อนสลับได้ ทำตามที่ขอ
7. เมนู **Settings > Basic** → คัดลอก **App ID** และ **App Secret** → ตั้งเป็น env var
   `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` บน Vercel → deploy ซ้ำ 1 ครั้ง

### 10.3 LINE Login — ⚠️⚠️ ต้องสร้างใน Provider เดียวกับ Messaging API เดิมเท่านั้น
**ถ้าสร้างผิด Provider ปุ่ม "เข้าสู่ระบบด้วย LINE" จะหาบัญชีที่เคยเชื่อมไว้ไม่เจอเงียบๆ** (LINE ผูก
userId ตาม Provider ไม่ใช่ตาม channel — ดูหัวไฟล์ `api/_oauth.js`)
1. เปิด https://developers.line.biz/console เข้าสู่ระบบด้วย `peoplelaw.center@gmail.com`
2. เลือก **Provider เดิม** ที่ใช้ตอนสร้าง Messaging API channel ในขั้นที่ 2 (ชื่อ Provider เดียวกับตอนนั้น
   — ห้ามกด "Create a new provider")
3. ในหน้า Provider นั้น → **Create a new channel** → เลือกประเภท **LINE Login** (ไม่ใช่ Messaging API
   ซ้ำ — เป็นคนละ channel type กัน ใช้คู่กันได้ในสองรอบ)
4. กรอกข้อมูลแอป (ชื่อ/หมวดหมู่/นโยบายความเป็นส่วนตัว) → สร้าง channel
5. แท็บ **LINE Login** ของ channel ใหม่นี้ → **Callback URL** → เพิ่ม
   `https://<โดเมน>/api/staff-auth?action=oauth-callback&provider=line` ตามด้านบน
6. แท็บ **Basic settings** → คัดลอก **Channel ID** และ **Channel secret** → ตั้งเป็น env var
   `LINE_LOGIN_CHANNEL_ID` / `LINE_LOGIN_CHANNEL_SECRET` บน Vercel (คนละตัวกับ `LINE_CHANNEL_SECRET`
   เดิมของ Messaging API — อย่าเผลอตั้งทับกัน) → deploy ซ้ำ 1 ครั้ง
7. ระบบตั้งใจ**ไม่ขอ scope "email"** จาก LINE Login (ต้องยื่นขออนุมัติแยกจาก LINE ก่อนถึงจะใช้ได้ —
   ดูหัวไฟล์ `api/_oauth.js`) ดังนั้น "เข้าสู่ระบบด้วย LINE" ใช้ได้เฉพาะเจ้าหน้าที่ที่เข้าด้วยอีเมลก่อน
   แล้วไปกด "เชื่อมบัญชี LINE" ที่แท็บโปรไฟล์/ตั้งค่าเองในหลังบ้านเท่านั้น — ไม่สามารถสมัครสมาชิกใหม่
   ผ่านปุ่ม LINE ล้วนๆ ได้ (ตั้งใจ กันบัญชีที่ไม่มีอีเมลจริงยืนยันเข้าระบบ)

## ⚠️ ก่อนเปิดให้ประชาชนใช้จริง

- **ให้นิติกร อบจ. หรือสภาทนายความตรวจเนื้อหากฎหมายทั้ง 5 หมวดใน `api/_keywords.js`** (ทุกหมวดมีป้าย
  `reviewed:false` — `npm test` เตือนไว้แล้ว) แก้เป็น `true` เมื่อตรวจผ่าน
- **ให้ยืนยันเบอร์สายด่วนฉุกเฉินใน `api/_cards.js` (ฟังก์ชัน `urgentCard`)** ว่าถูกต้อง/ใช้งานได้จริง
- ตัดสินใจเรื่อง "ใครเป็นผู้ตอบจริง" แล้วตั้งค่าที่แท็บ "โปรไฟล์/ตั้งค่า" ในหลังบ้าน (ช่อง "คำเรียกผู้ตอบ"
  เช่น "นิติกร อบจ." หรือ "ทนายอาสาสภาทนายความ") — ถ้ายังไม่ตัดสินใจ ปล่อยเป็นค่าเริ่มต้น "เจ้าหน้าที่" ไปก่อนได้
- **สมัคร LINE Verified Account** (ไอคอนโล่เขียว/badge ยืนยันตัวตน) ที่ manager.line.biz →
  ตั้งค่า > Account settings > Account status — ต้องมีเอกสารยืนยันหน่วยงาน (เช่น หนังสือมอบอำนาจ อบจ.)
  ใช้เวลาให้ LINE ตรวจสอบหลายวัน ควรยื่นเรื่องแต่เนิ่นๆ ไม่ต้องรอขั้นอื่นเสร็จก่อน — ช่วยสร้างความเชื่อมั่น
  ให้ประชาชนว่าเป็นบัญชีทางการจริง ไม่ใช่บัญชีปลอม
- **อบรมทีมแอดมิน/ทนายอาสาให้ใช้ LINE Official Account Manager** (manager.line.biz) เป็นเครื่องมือเสริม
  นอกเหนือจากหน้า `staff.html` ของระบบเรา — โดยเฉพาะฟีเจอร์ **Tag ลูกค้า** (ติด tag เช่น "เคสด่วน",
  "รอเอกสาร" ให้บัญชีผู้ใช้แต่ละคนใน OA Manager) ซึ่งเป็นคนละระบบกับสถานะเรื่อง (`cases.status`) ในเว็บเรา
  — ใช้ประกอบกันได้ (เช่น ติด tag ไว้ดูภาพรวมเร็วๆ ใน OA Manager แต่รายละเอียด/ประวัติเรื่องยังดูที่
  `staff.html` เป็นหลัก) ไม่ได้บังคับต้องใช้ ทีมเลือกใช้ตามสะดวก
