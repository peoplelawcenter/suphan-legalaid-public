/* api/_avatar.js — ตรวจ "รูปโปรไฟล์เจ้าหน้าที่" ก่อนบันทึก (7 ต.ค. 69 · ตารางฝั่งฐาน supabase-migration-16-staff-avatar.sql)
   ไฟล์นี้ "บริสุทธิ์": ไม่แตะ DB/เน็ต/env — เทสต์ import ตรงได้ (scripts/test-avatar.mjs)

   หน้าเว็บ (staff.html) ครอป+ย่อภาพเป็น JPEG 256×256 ด้วย canvas แล้วส่งมาเป็น data URL — เซิร์ฟเวอร์ "ไม่เชื่อ" ฝั่งหน้าเว็บ
   ตรวจซ้ำเองทั้งหมด (คนยิง API ตรงๆ ก็ส่งอะไรมาก็ได้) และเก็บค่าที่ผ่านการ "ถอดแล้วเข้ารหัสใหม่" เท่านั้น ไม่เก็บสตริงดิบที่ส่งมา:
   · ขึ้นต้น data:image/jpeg;base64, เท่านั้น (ไม่รับ PNG/SVG/GIF — SVG = สคริปต์ได้ · ที่เหลือคุมขนาดยาก)
   · base64 ล้วน ไม่มีช่องว่าง/ตัวอักษรแปลก (ค่านี้ถูกใส่ใน CSS background-image ฝั่งหน้าเว็บ ต้องไม่มีอะไรหลุดออกจาก url() ได้)
   · ถอดแล้วต้องขึ้นต้นด้วยหัวไฟล์ JPEG จริง (FF D8 FF) · ≤ 80 KB · อ่านขนาดภาพจาก SOF marker ต้อง 64–512 px ทั้งสองด้าน
     (กันยัดภาพใหญ่/ไฟล์อื่นที่ตั้งชื่อเป็น jpeg ลงฐาน) */

export const AVATAR_PREFIX = "data:image/jpeg;base64,";
export const AVATAR_MAX_BYTES = 80 * 1024;
export const AVATAR_MIN_DIM = 64;
export const AVATAR_MAX_DIM = 512;
// base64 ยาว ≈ 4/3 ของไบต์ — ใช้เป็นเพดานตัดตั้งแต่ยังไม่ถอดรหัส (ไม่ต้องจัดสรรหน่วยความจำให้สตริงที่ใหญ่เกินเหตุ)
const MAX_B64_CHARS = Math.ceil(AVATAR_MAX_BYTES / 3) * 4;

/* อ่านกว้าง×สูงจาก JPEG โดยไล่ marker ไปหา SOF (Start Of Frame) — คืน null ถ้าโครงสร้างผิด/ไม่เจอ */
export function jpegDimensions(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null; // ต้องเป็นต้น marker เสมอ — ไม่ใช่ = ไฟล์เพี้ยน
    while (buf[i] === 0xff && i < buf.length) i++; // ข้าม fill byte 0xFF ที่ซ้อนกัน
    const marker = buf[i];
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // marker ไม่มีความยาว
    if (marker === 0xd9 || marker === 0xda) return null; // EOI/SOS มาก่อนเจอ SOF = ไม่มีขนาดภาพ
    if (i + 1 >= buf.length) return null;
    const len = buf.readUInt16BE(i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 6 >= buf.length) return null;
      return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return null;
}

/* ตรวจ+ทำให้เป็นรูปแบบมาตรฐาน — ผ่าน: { ok:true, dataUrl, bytes, width, height } · ไม่ผ่าน: { ok:false, error } (ภาษาไทย ส่งให้ผู้ใช้อ่านได้) */
export function parseAvatarDataUrl(input) {
  if (typeof input !== "string" || !input.startsWith(AVATAR_PREFIX)) {
    return { ok: false, error: "รูปโปรไฟล์ต้องเป็นไฟล์ภาพ JPEG (ระบบย่อภาพให้อัตโนมัติ ลองเลือกรูปใหม่อีกครั้ง)" };
  }
  const b64 = input.slice(AVATAR_PREFIX.length);
  if (!b64.length || b64.length > MAX_B64_CHARS) {
    return { ok: false, error: `รูปโปรไฟล์ใหญ่เกินไป (ไม่เกิน ${Math.round(AVATAR_MAX_BYTES / 1024)} KB หลังย่อ)` };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, error: "ข้อมูลรูปโปรไฟล์ไม่ถูกต้อง กรุณาเลือกรูปใหม่" };
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length > AVATAR_MAX_BYTES) {
    return { ok: false, error: `รูปโปรไฟล์ใหญ่เกินไป (ไม่เกิน ${Math.round(AVATAR_MAX_BYTES / 1024)} KB หลังย่อ)` };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
    return { ok: false, error: "ไฟล์ที่ส่งมาไม่ใช่ภาพ JPEG จริง กรุณาเลือกรูปใหม่" };
  }
  const dim = jpegDimensions(buf);
  if (!dim) return { ok: false, error: "อ่านขนาดภาพไม่ได้ กรุณาเลือกรูปใหม่" };
  const { width, height } = dim;
  if (width < AVATAR_MIN_DIM || height < AVATAR_MIN_DIM || width > AVATAR_MAX_DIM || height > AVATAR_MAX_DIM) {
    return { ok: false, error: `ขนาดรูปโปรไฟล์ต้องอยู่ระหว่าง ${AVATAR_MIN_DIM}–${AVATAR_MAX_DIM} พิกเซล` };
  }
  return { ok: true, dataUrl: AVATAR_PREFIX + buf.toString("base64"), bytes: buf.length, width, height };
}

/* ค่าจากฐานที่ปลอดภัยพอจะส่งให้หน้าเว็บ — ตรวจรูปแบบเบาๆ (ไม่ถอดรหัสซ้ำ) กันแถวที่ถูกแก้ตรงในฐานจนมีอักขระหลุดมาใน CSS url() */
export function safeAvatarForClient(v) {
  return typeof v === "string" && v.startsWith(AVATAR_PREFIX) && /^[A-Za-z0-9+/]+={0,2}$/.test(v.slice(AVATAR_PREFIX.length)) ? v : null;
}
