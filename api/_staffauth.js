/* api/_staffauth.js — ระบบล็อกอินเจ้าหน้าที่ด้วยอีเมล+รหัสผ่าน+ยืนยัน OTP (เขียนใหม่ทั้งไฟล์ 17 ก.ย. 69
   รอบ 3 — บอสสั่ง "ให้ฝั่ง LINE OA เป็นของประชาชนไปเลย" ย้ายเจ้าหน้าที่ออกจาก LINE ทั้งหมด แทนที่ลิงก์
   เซ็น HMAC แบบเดิม (ผูกกับ LINE uid, ต้องกดปุ่มในไลน์ทุกครั้ง) ด้วยเว็บล็อกอินจริง + session cookie

   หลักการเดิมที่ยังคงไว้: อ่านสิทธิ์ (role/active) สดจากตาราง staff ทุกครั้งที่ตรวจ session (ห้าม cache
   ยาว) — ถอนสิทธิ์แล้วต้องมีผลทันที เหมือนบทเรียนเดิมของระบบนี้และระบบพี่น้อง แค่ตัวยืนยันตัวตน (identity)
   เปลี่ยนจาก LINE uid → staff.id (bigint) เพราะเจ้าหน้าที่ไม่จำเป็นต้องมี LINE อีกต่อไป (เชื่อม LINE
   ได้แบบไม่บังคับผ่าน #เชื่อม ใน line-webhook.js เพื่อรับแจ้งเตือนเสริมเท่านั้น ไม่ใช่ตัวยืนยันตัวตน)

   ✅ เพิ่ม 18 ก.ย. 69 — ล็อกอินผ่าน Google/Facebook/LINE จริง (ดู api/_oauth.js + action=oauth-start/
   oauth-callback ใน api/staff-auth.js) ยังคงออก session cookie ตัวเดียวกันนี้เสมอไม่ว่าจะเข้าทางไหน —
   ตัวยืนยันตัวตนยังเป็น staff.id เท่านั้น อีเมล/รหัสผ่าน/OTP เป็นแค่หนึ่งในหลายวิธี "พิสูจน์ว่าเป็น
   staff.id แถวไหน" ก่อนออก session */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "./_db.js";

export const COOKIE_NAME = "staff_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ชม. (เซสชันทำงานหนึ่งวัน ไม่ใช่ "จำฉันไว้" ยาวๆ)
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 10;

function secret() {
  const s = process.env.STAFF_SECRET || process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!s) throw new Error("ยังไม่ตั้ง STAFF_SECRET หรือ LINE_CHANNEL_ACCESS_TOKEN");
  return s;
}
function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}
function timingSafeEq(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/* ═══ คุกกี้เซสชัน — httpOnly กัน JS ฝั่งหน้าเว็บอ่านค่าได้ (กัน XSS ขโมยเซสชัน), Secure ใช้ได้เฉพาะ HTTPS
   (Vercel prod เป็น HTTPS เสมออยู่แล้ว), SameSite=Lax กัน CSRF พื้นฐานโดยยัง submit ฟอร์มข้ามไซต์ได้ปกติ ═══ */
export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
export function sessionCookieHeader(token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearSessionCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/* ═══ เซ็น/ตรวจ token เซสชัน (แนวเดียวกับลิงก์ HMAC เดิม แต่ผูกกับ staff.id ไม่ใช่ LINE uid) ═══ */
export function makeSessionToken(staffId, ttlMs = SESSION_TTL_MS) {
  const id = String(staffId);
  const exp = Date.now() + (Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : SESSION_TTL_MS);
  const payload = `${id}.${exp}`;
  return payload + "." + sign(payload);
}
export function readSessionToken(tok) {
  const t = String(tok || "").trim();
  if (!t) return { ok: false, reason: "ยังไม่ได้เข้าสู่ระบบ" };
  const parts = t.split(".");
  if (parts.length !== 3) return { ok: false, reason: "เซสชันไม่ถูกต้อง" };
  const [idRaw, expRaw, sig] = parts;
  if (!timingSafeEq(sig, sign(`${idRaw}.${expRaw}`))) return { ok: false, reason: "เซสชันไม่ถูกต้องหรือถูกแก้ไข" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, expired: true, reason: "เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่" };
  const id = Number(idRaw);
  if (!Number.isInteger(id)) return { ok: false, reason: "เซสชันไม่ถูกต้อง" };
  return { ok: true, staffId: id };
}

/* ═══ รหัสผ่าน — bcryptjs (pure JS ไม่ต้องคอมไพล์ native เหมาะกับ Vercel serverless) ═══ */
export async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}
export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(plain), hash);
}

/* ═══ OTP 6 หลัก — HMAC เก็บเฉพาะแฮช (ไม่เก็บรหัสจริงใน DB) มีเพดานจำนวนครั้งที่กรอกผิดกันเดาสุ่ม ═══ */
export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}
export function hashOtp(code) {
  return crypto.createHmac("sha256", secret()).update(String(code)).digest("hex");
}
export function otpMatches(code, hash) {
  if (!hash) return false;
  return timingSafeEq(hashOtp(code), hash);
}

/* ⛔⛔ escape wildcard พิเศษของ SQL LIKE/ILIKE (%, _, \) ก่อนใช้ใน .ilike() เสมอ ห้ามลืม — พบจากรีวิว
   ความปลอดภัยอัตโนมัติหลัง push 18 ก.ย. 69: `_`/`%` เป็นตัวอักษรที่ใช้ได้จริงในอีเมลตามสเปก (RFC 5322)
   และมีจริง (เช่น john_doe@...) ถ้าไม่ escape ก่อน ทุก .ilike("email", ...) ใน api/staff-auth.js จะ
   ตีความเป็น wildcard แทนตัวอักษรจริง — "ค้นหาอีเมลตรงกันเป๊ะ" กลายเป็น "ค้นหาอีเมลที่เข้ารูปแบบ" เสี่ยง
   จับคู่บัญชีผิดคน ⛔⛔ จุดร้ายแรงสุดคือ action=oauth-callback (identity.email จาก Google/Facebook) เพราะ
   จับคู่บัญชีผิดแล้วออก session cookie ทันที **ไม่มีรหัสผ่าน/OTP เป็นด่านที่สองอีกชั้นเหมือนจุดอื่น**
   (login/verify-otp/reset-password ยังต้องผ่านรหัสผ่าน/OTP อีกชั้นแม้จับคู่แถวผิดก็ตาม — จุดอื่นจึงมี
   ความเสี่ยงต่ำกว่าแต่ escape ให้ครบทุกจุดเพื่อความถูกต้อง ไม่ใช่เพราะจำเป็นเท่ากันหมด) Postgres LIKE/
   ILIKE ใช้ \ เป็น escape character โดยดีฟอลต์อยู่แล้วไม่ต้องประกาศ ESCAPE เพิ่ม — escape \ เองก่อนเสมอ
   (ป้องกัน \_ ที่ผู้ใช้พิมพ์เองกลายเป็น escape sequence โดยไม่ตั้งใจ) */
export function escapeLikePattern(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function atLeast(role, need) {
  if (need === "admin") return role === "admin";
  return role === "admin" || role === "staff";
}

/* ด่านเดียวที่ api/staff.js ต้องผ่านก่อนทำอะไรทั้งนั้น — อ่านสิทธิ์สดจาก DB ทุกครั้ง (ไม่ cache)

   ⛔ เปลี่ยน 18 ก.ย. 69 — แยก "เข้าสู่ระบบได้" ออกจาก "มีสิทธิ์ใช้งานได้" บอสสั่ง: เจ้าหน้าที่ล็อกอินผ่าน
   ช่องทางใดก็ได้ (อีเมล/รหัสผ่าน หรือ Google/Facebook/LINE) ต้องได้ session ทันทีที่พิสูจน์ตัวตนสำเร็จ
   (ดู action=login/oauth-callback ใน api/staff-auth.js — ไม่บล็อกที่ตอนล็อกอินอีกต่อไป) แต่ห้ามดู/ทำ
   อะไรในระบบได้เลยจนกว่าแอดมินจะอนุมัติ (approved_at) — ด่านนี้จึงยังเป็นตัวบล็อกจริงเหมือนเดิมทุกจุด
   แค่ย้ายมาบล็อกที่ "การใช้งาน" แทน "การเข้าสู่ระบบ" ไม่กระทบความปลอดภัย (cookie เองไม่มีสิทธิ์อะไรจนกว่า
   จะผ่านด่านนี้) — แยก pending_approval (ยังไม่เคยอนุมัติ) ออกจาก suspended (เคยอนุมัติแล้วถูกถอนสิทธิ์)
   ให้ staff.html แสดงข้อความที่ตรงสถานการณ์ (โค้ดฝั่งหน้าเว็บไม่ต้องแก้ — ใช้กล่อง #invalid เดิมที่อ่าน
   error/hint จาก response นี้อยู่แล้ว) */
export async function whoFromSession(req, need = "staff") {
  const cookies = parseCookies(req);
  const read = readSessionToken(cookies[COOKIE_NAME]);
  if (!read.ok) {
    return {
      ok: false, status: 401,
      code: read.expired ? "session_expired" : "session_bad",
      error: read.expired ? "เซสชันหมดอายุแล้ว" : "ยังไม่ได้เข้าสู่ระบบ",
      hint: "กรุณาเข้าสู่ระบบใหม่ที่หน้า staff-login.html",
    };
  }
  const { data } = await db().from("staff").select("id,role,active,display_name,approved_at").eq("id", read.staffId).maybeSingle();
  if (!data) {
    return { ok: false, status: 401, code: "session_bad", error: "ไม่พบบัญชีผู้ใช้งาน", hint: "กรุณาเข้าสู่ระบบใหม่ที่หน้า staff-login.html" };
  }
  if (!data.approved_at) {
    return { ok: false, status: 403, code: "pending_approval", error: "บัญชีของท่านรอผู้ดูแลระบบอนุมัติอยู่", hint: "เมื่อผู้ดูแลระบบอนุมัติแล้ว กลับมาที่หน้านี้อีกครั้งเพื่อใช้งานได้ทันที" };
  }
  if (!data.active) {
    return { ok: false, status: 403, code: "suspended", error: "บัญชีถูกระงับการใช้งาน", hint: "ติดต่อผู้ดูแลระบบเพื่อสอบถามหรือขอสิทธิ์คืน" };
  }
  if (!atLeast(data.role, need)) {
    return { ok: false, status: 403, code: "need_role", error: need === "admin" ? "หน้านี้เปิดให้เฉพาะผู้ดูแลระบบ" : "ไม่มีสิทธิ์เจ้าหน้าที่", hint: "" };
  }
  return { ok: true, staffId: data.id, role: data.role, displayName: data.display_name };
}

/* เจ้าหน้าที่ที่ควรได้รับแจ้งเตือนของหมวดกฎหมายนี้ (แนวคิดจาก Traffy Fondue "ตั้งค่าการแจ้งเตือน" ต่อหมวด)
   notify_categories = null/[] หมายถึง "รับทุกหมวด" (ค่าเริ่มต้น) — คืน id มาด้วยเพื่อให้ผู้เรียกจับคู่กับ
   cases.assigned_staff_id ได้ (เดิมจับคู่ด้วย line_uid ซึ่งตอนนี้เป็นค่าที่ไม่บังคับมีแล้ว)
   ⚠️ ต้องรัน supabase-migration-5-notify-categories.sql ก่อนคอลัมน์ notify_categories จะมีจริง — ถ้ายังไม่ได้
   รัน select จะ error ทั้งคำสั่ง ต้อง fallback ไปดึงแบบไม่มีคอลัมน์นี้แทน (เท่ากับ "รับทุกหมวด" ทุกคน) */
export async function notifiableStaff(category) {
  let rows, hasCategories = true;
  {
    const { data, error } = await db().from("staff").select("id,line_uid,email,notify_line,notify_email,notify_categories").eq("active", true);
    if (error) {
      hasCategories = false;
      const fb = await db().from("staff").select("id,line_uid,email,notify_line,notify_email").eq("active", true);
      rows = fb.data || [];
    } else {
      rows = data || [];
    }
  }
  if (!hasCategories) return rows;
  return rows.filter((s) => !s.notify_categories || !s.notify_categories.length || s.notify_categories.includes(category));
}
