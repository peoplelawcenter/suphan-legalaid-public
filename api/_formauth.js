/* api/_formauth.js — ลิงก์เฉพาะบุคคลสำหรับฟอร์มประชาชน (ปรึกษา/ร้องเรียน) — ไม่ใช้ LIFF เด็ดขาด

   ทำไมไม่ใช้ LIFF: บทเรียนจากระบบพี่น้อง (ระบบดิจิทัลสำนักปลัด) — LIFF พัง "เข้าฟอร์มไม่ได้" ซ้ำ 4 รอบ
   ใน 5 วัน (เด้งฟอร์มผิดใบ, error 400, ไลน์ทิ้งคิวรี่, วนหน้า login ไม่จบ) ต้นตอคือไม่ได้คุมเส้นทาง
   ล็อกอินเอง — ทางแก้ทั้งสองระบบเหมือนกัน: กดปุ่มในไลน์เป็น postback ก่อน (บอทรู้ uid จริงจากไลน์เสมอ)
   แล้วค่อยออกลิงก์เว็บธรรมดาที่เซ็นลายเซ็นกำกับ ไม่มี SDK ไม่มีจอล็อกอิน จึงไม่มีทางวนลูป

   ต่างจากระบบพี่น้องที่มีชั้นสิทธิ์ staff/admin ต้องเช็ค — ฟอร์มนี้ **ประชาชนทุกคนใช้ได้เท่ากัน**
   (ไม่มี role) ลิงก์แค่ยืนยันว่า "รหัสนี้ออกโดยบอทจริง ให้คนที่กดปุ่มคนนี้เท่านั้น" กับผูก form_type
   ไว้ในลายเซ็นด้วย กันเอาลิงก์ฟอร์มปรึกษาไปยื่นเป็นฟอร์มร้องเรียน (defense in depth เล็กๆ)

   อายุสั้นกว่าระบบพี่น้อง (30 นาทีพอสำหรับกรอกครั้งเดียว ไม่ใช่ 12 ชม.) เพราะไม่มีสิทธิ์ให้เช็คซ้ำตอน
   หมดอายุ — สั้นเข้าไว้ปิดหน้าต่างเสี่ยงที่ลิงก์ถูกส่งต่อให้คนอื่นกรอกแทน */
import crypto from "node:crypto";

export const FORM_TOKEN_TTL_MS = 30 * 60 * 1000;

function secret() {
  const s = process.env.FORM_SECRET || process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!s) throw new Error("ยังไม่ตั้ง FORM_SECRET หรือ LINE_CHANNEL_ACCESS_TOKEN (ใช้เป็นกุญแจเซ็นลิงก์ฟอร์ม)");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

/* uid ของไลน์เป็น "U" + hex จึงไม่มีจุดปนอยู่ ปลอดภัยที่จะต่อด้วย "." เป็นตัวแบ่ง */
export function makeFormToken(uid, formType, ttlMs = FORM_TOKEN_TTL_MS) {
  const id = String(uid || "").trim();
  const ft = String(formType || "").trim();
  if (!id || !ft) return "";
  // ไม่ตั้งค่าต่ำสุดแบบ Math.max ตรงนี้โดยตั้งใจ — ผู้เรียกในโค้ดจริงมีแค่ 2 จุด (makeFormToken(uid,type))
  // ใช้ FORM_TOKEN_TTL_MS เสมออยู่แล้ว ส่วน scripts/test-formauth.mjs ต้องส่ง ttl เป็นลบได้เพื่อจำลอง
  // โทเคนหมดอายุแล้วจริงๆ (ถ้ามี Math.max(60000,...) คั่นไว้ ตัวเลขลบจะถูกเด้งกลับเป็น 60 วิเสมอ
  // ทำให้ทดสอบ "โทเคนหมดอายุ" ไม่ได้เลย)
  const exp = Date.now() + (Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : FORM_TOKEN_TTL_MS);
  const payload = `${id}.${ft}.${exp}`;
  return payload + "." + sign(payload);
}

export function readFormToken(tok, expectFormType) {
  const t = String(tok || "").trim();
  if (!t) return { ok: false, reason: "ไม่มีรหัสผ่านทางในลิงก์" };
  const parts = t.split(".");
  if (parts.length !== 4) return { ok: false, reason: "ลิงก์ไม่ถูกต้อง" };
  const [uid, formType, expRaw, sig] = parts;
  const want = sign(`${uid}.${formType}.${expRaw}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "ลิงก์ถูกแก้ไขหรือไม่ได้มาจากบอท" };
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: "ลิงก์ไม่ถูกต้อง" };
  if (Date.now() > exp) return { ok: false, expired: true, reason: "ลิงก์หมดอายุแล้ว (มีอายุ 30 นาที)" };
  if (expectFormType && formType !== expectFormType) {
    return { ok: false, reason: "ลิงก์นี้ใช้กับฟอร์มนี้ไม่ได้" };
  }
  return { ok: true, uid, formType };
}

/* ═══ โหมดเว็บของแบบคำร้องขอเข้ารับคำปรึกษา (เพิ่ม 30 ก.ย. 69 — บอสสั่ง "กดได้ทั้งบน web และ line oa") ═══
   เปิดตรงจากเว็บได้โดยไม่มีลิงก์ ?k= **เฉพาะ formType "appointment" เท่านั้น** — consult/complaint/
   addevidence ยังบังคับลิงก์จากไลน์เหมือนเดิมทุกอย่าง (ฟอร์มพวกนั้นผูกไฟล์หลักฐาน/สิทธิ์ติดตามเรื่องกับ uid)
   มี ?k= มาแต่เสีย/หมดอายุ = ปฏิเสธ ไม่ถอยไปโหมดเว็บเงียบๆ (หน้าเว็บให้ผู้ใช้เลือกกดยื่นแบบไม่ผ่านไลน์เองได้) */
export function resolveFormAuth(body) {
  const b = body && typeof body === "object" ? body : {};
  const hasToken = !!String(b.k || "").trim();
  if (!hasToken && b.formType === "appointment") return { ok: true, uid: null, formType: "appointment", web: true };
  return readFormToken(b.k, b.formType);
}

/* ตราเวลาเปิดฟอร์มเซ็น HMAC — เซิร์ฟเวอร์ออกให้ตอนหน้าเว็บโหลด (action=appt-config) แล้วตรวจตอนยื่นว่า
   ใช้เวลากรอกไม่น้อยกว่าเกณฑ์ (บอทยิงทันที = ไม่ผ่าน) และไม่เก่าเกิน (กันเก็บตราไว้ยิงทีหลัง) — ปลอมเวลา
   เองไม่ได้เพราะลายเซ็นผูกกับเวลาที่ออก (ต่างจากให้หน้าเว็บส่ง "ใช้เวลากี่วินาที" มาเองที่เชื่อไม่ได้) */
export function makeWebFormStamp(now = Date.now()) {
  const t = String(Math.floor(Number(now)));
  return `w.${t}.${sign("apptweb." + t)}`;
}

export function readWebFormStamp(stamp, { now = Date.now(), minMs = 4000, maxMs = 6 * 60 * 60 * 1000 } = {}) {
  const parts = String(stamp || "").trim().split(".");
  if (parts.length !== 3 || parts[0] !== "w" || !/^\d{10,16}$/.test(parts[1])) {
    return { ok: false, code: "stamp_bad", reason: "แบบฟอร์มไม่สมบูรณ์ กรุณาโหลดหน้าใหม่แล้วกรอกอีกครั้ง" };
  }
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign("apptweb." + parts[1]));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: "stamp_bad", reason: "แบบฟอร์มไม่สมบูรณ์ กรุณาโหลดหน้าใหม่แล้วกรอกอีกครั้ง" };
  }
  const age = Number(now) - Number(parts[1]);
  if (age < minMs) return { ok: false, code: "too_fast", reason: "ส่งเร็วเกินไป กรุณาตรวจสอบข้อมูลอีกครั้งแล้วกด \"ยื่นแบบคำร้อง\" ใหม่" };
  if (age > maxMs) return { ok: false, code: "stamp_expired", reason: "เปิดหน้านี้ค้างไว้นานเกินไป กรุณาโหลดหน้าใหม่แล้วกรอกอีกครั้ง" };
  return { ok: true };
}

/* แฮช IP รายวันสำหรับนับเพดานกันสแปม — HMAC-SHA256(FORM_SECRET, ip|วันที่) ไม่เก็บ IP ดิบลง DB
   (PDPA) และเปลี่ยนค่าทุกวัน จึงเอาไปโยงข้ามวันไม่ได้ */
export function ipDayHash(ip, dayIso) {
  return crypto.createHmac("sha256", secret()).update(`apptip|${String(ip || "unknown")}|${String(dayIso || "")}`).digest("hex");
}
