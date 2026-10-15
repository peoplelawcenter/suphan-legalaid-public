/* api/_oauth.js — โปรโตคอล OAuth 2.0 (Authorization Code) สำหรับปุ่ม "เข้าสู่ระบบด้วย Google/Facebook/LINE"
   เพิ่ม 18 ก.ย. 69 (บอสสั่งให้หน้าล็อกอินมีหลายช่องทางเหมือน Traffy Fondue จริง ไม่ใช่แค่ปุ่มสวยๆ ที่กดไม่ได้)

   ไฟล์นี้มีแต่ฟังก์ชัน "บริสุทธิ์"/เรียก API ภายนอกล้วนๆ ไม่แตะ DB (ตามธรรมเนียมไฟล์ _xxx.js ของโปรเจกต์นี้
   ที่แยกโปรโตคอล/คำนวณออกจากตัว handler) — ตรรกะจับคู่บัญชี/สร้างบัญชีใหม่/ออก session อยู่ที่
   api/staff-auth.js (action=oauth-start / oauth-callback) เพราะต้องแตะ DB + คุกกี้เซสชันโดยตรง

   ⚠️ อีเมลที่ผู้ให้บริการยืนยันมาแล้ว (Google/Facebook) เชื่อถือได้เทียบเท่าอีเมลที่ระบบเราเองยืนยันด้วย OTP
   — จึงใช้จับคู่/สร้างบัญชีใหม่ได้เลยโดยไม่ต้องส่ง OTP ซ้ำ (Google: ใช้เฉพาะ email_verified=true เท่านั้น
   Facebook: Graph API คืนเฉพาะอีเมลที่ยืนยันแล้วอยู่แล้วตามนโยบายของ Facebook เอง)

   ⚠️⚠️ LINE Login ไม่ขอ scope "email" (ต้องยื่นขออนุมัติแยกจาก LINE Developers Console ก่อน ไม่ได้มาเฉยๆ
   — ดู docs/SETUP-GUIDE.md) จึงใช้ "เข้าสู่ระบบด้วย LINE" ได้เฉพาะบัญชีที่เคยเชื่อม LINE ไว้แล้วผ่าน
   #เชื่อม <รหัส> ในแชต (staff.line_uid มีค่าอยู่ก่อนแล้ว) เท่านั้น — ห้ามสร้างบัญชีใหม่จาก LINE โดยไม่มี
   อีเมลยืนยัน (ผิดหลัก "ต้องมีอีเมลจริงก่อนเข้าใช้งาน" ของระบบนี้)

   ⚠️⚠️ LINE Login channel ต้องสร้างอยู่ "Provider" เดียวกับ LINE Messaging API channel เดิมของศูนย์นี้
   (@073kbdgu) เท่านั้น — LINE ผูก userId (sub) ตาม Provider ไม่ใช่ตาม channel ถ้าสร้างคนละ Provider
   sub ที่ได้จะไม่ตรงกับ line_uid ที่เก็บไว้จาก Messaging API เลย ทำให้ "เข้าสู่ระบบด้วย LINE" หาบัญชี
   ไม่เจอเงียบๆ ทั้งที่เคยเชื่อมไว้แล้วจริง (ดูรายละเอียดใน docs/SETUP-GUIDE.md ขั้นตอนสร้าง LINE Login channel) */
import crypto from "node:crypto";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 นาที พอสำหรับกดปุ่ม → ล็อกอินที่ฝั่งผู้ให้บริการ → เด้งกลับมา

function stateSecret() {
  const s = process.env.STAFF_SECRET || process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
  if (!s) throw new Error("ยังไม่ตั้ง STAFF_SECRET");
  return s;
}
function hmac(payload) {
  return crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}
function timingSafeEq(a, b) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export const PROVIDERS = ["google", "facebook", "line"];
export const IDENTITY_COLUMN = { google: "google_sub", facebook: "facebook_id", line: "line_uid" };

/* ═══ state กัน CSRF ระหว่างขาไป (oauth-start) กับขากลับ (oauth-callback) — เซ็น HMAC แบบเดียวกับ
   session token ไม่ต้องเก็บลง DB (ไม่มีสถานะฝั่งเซิร์ฟเวอร์ที่ต้องเคลียร์ทิ้งทีหลัง) ═══ */
export function makeOauthState(provider) {
  const nonce = crypto.randomBytes(12).toString("base64url");
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${provider}.${nonce}.${exp}`;
  return payload + "." + hmac(payload);
}
export function readOauthState(token) {
  const t = String(token || "");
  const parts = t.split(".");
  if (parts.length !== 4) return { ok: false, reason: "state ไม่ถูกต้อง" };
  const [provider, nonce, expRaw, sig] = parts;
  if (!PROVIDERS.includes(provider)) return { ok: false, reason: "provider ไม่ถูกต้อง" };
  const payload = `${provider}.${nonce}.${expRaw}`;
  if (!timingSafeEq(sig, hmac(payload))) return { ok: false, reason: "state ไม่ถูกต้องหรือถูกแก้ไข" };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: "หมดเวลา กรุณาลองใหม่" };
  return { ok: true, provider };
}

/* ═══ ผูก state เข้ากับ "เบราว์เซอร์เดิมที่กดปุ่มเริ่มต้น" ด้วยคุกกี้ httpOnly ชั่วคราว (เพิ่มหลังทวนโค้ด
   เองอีกรอบ 18 ก.ย. 69 — ลายเซ็น HMAC บน state เพียงอย่างเดียวกัน "ปลอมแปลง state" ได้ แต่กัน "เอา state/
   code ที่ตัวเองขอมาจริงจากบัญชีตัวเอง ไปหลอกให้เหยื่อเปิดลิงก์ oauth-callback ในเบราว์เซอร์ของเหยื่อ"
   ไม่ได้ — ถ้าเหยื่อ login อยู่พอดี โค้ดจะตีความเป็น "โหมดเชื่อมบัญชีเพิ่ม" แล้วเอาบัญชี Google/Facebook/
   LINE ของผู้โจมตีไปผูกกับ staff.id ของเหยื่อโดยไม่ได้ตั้งใจ (account-linking CSRF) — คุกกี้นี้พิสูจน์ว่า
   "เบราว์เซอร์ที่เปิด callback คือเบราว์เซอร์เดียวกับที่กด oauth-start จริง" ก่อนเชื่อ state ═══ */
const FLOW_COOKIE = "oauth_flow";
export function oauthFlowCookieHeader(state) {
  const maxAge = Math.floor(STATE_TTL_MS / 1000);
  return `${FLOW_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearOauthFlowCookieHeader() {
  return `${FLOW_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export function oauthFlowCookieMatches(cookies, state) {
  const stored = cookies?.[FLOW_COOKIE];
  if (!stored || !state) return false;
  return timingSafeEq(stored, state);
}

export function providerConfigured(provider) {
  if (provider === "google") return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (provider === "facebook") return !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
  if (provider === "line") return !!(process.env.LINE_LOGIN_CHANNEL_ID && process.env.LINE_LOGIN_CHANNEL_SECRET);
  return false;
}

// redirect_uri ต้องตรงเป๊ะกับที่ลงทะเบียนไว้ในคอนโซลของผู้ให้บริการแต่ละเจ้า (ดู docs/SETUP-GUIDE.md)
export function redirectUri(provider) {
  const site = process.env.SITE_URL || "https://suphan-legalaid.vercel.app";
  return `${site}/api/staff-auth?action=oauth-callback&provider=${provider}`;
}

export function authorizeUrl(provider, state) {
  const redirect_uri = redirectUri(provider);
  if (provider === "google") {
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri, response_type: "code",
      scope: "openid email profile", state, access_type: "online", prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  if (provider === "facebook") {
    const p = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID, redirect_uri, state,
      scope: "public_profile,email", response_type: "code",
    });
    return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
  }
  if (provider === "line") {
    const p = new URLSearchParams({
      response_type: "code", client_id: process.env.LINE_LOGIN_CHANNEL_ID, redirect_uri, state,
      scope: "profile openid", bot_prompt: "normal",
    });
    return `https://access.line.me/oauth2/v2.1/authorize?${p}`;
  }
  throw new Error("unknown provider");
}

// ถอด payload ของ JWT (id_token) โดยไม่ตรวจลายเซ็น — ปลอดภัยเฉพาะกรณีนี้เพราะ id_token มาจากการยิง
// token endpoint ตรงด้วย client_secret ผ่าน HTTPS เอง (ช่องทางที่เชื่อถือได้อยู่แล้ว) ไม่ใช่รับมาจาก
// ฝั่งเบราว์เซอร์ผู้ใช้ที่ต้องตรวจลายเซ็นกันปลอม
export function decodeJwtPayload(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length < 2) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { return null; }
}

/* แลกโค้ดที่ผู้ให้บริการส่งกลับมาเป็นข้อมูลตัวตน — คืน { identityId, email (หรือ null), name } เสมอ
   throw เมื่อแลกไม่สำเร็จ (ผู้เรียกใน staff-auth.js ดักด้วย try/catch แล้วพากลับหน้าล็อกอินพร้อมข้อความ) */
export async function exchangeCodeForIdentity(provider, code) {
  const redirect_uri = redirectUri(provider);

  if (provider === "google") {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code, redirect_uri, grant_type: "authorization_code",
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || "แลก token กับ Google ไม่สำเร็จ");
    const payload = decodeJwtPayload(tok.id_token);
    if (!payload?.sub) throw new Error("ไม่พบข้อมูลผู้ใช้จาก Google");
    return { identityId: payload.sub, email: payload.email_verified ? String(payload.email || "").toLowerCase() : null, name: payload.name || "" };
  }

  if (provider === "facebook") {
    const p = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID, client_secret: process.env.FACEBOOK_APP_SECRET,
      redirect_uri, code,
    });
    const r = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${p}`);
    const tok = await r.json();
    if (!r.ok || !tok.access_token) throw new Error(tok.error?.message || "แลก token กับ Facebook ไม่สำเร็จ");
    const pr = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(tok.access_token)}`);
    const profile = await pr.json();
    if (!pr.ok || !profile.id) throw new Error(profile.error?.message || "ไม่พบข้อมูลผู้ใช้จาก Facebook");
    return { identityId: profile.id, email: profile.email ? String(profile.email).toLowerCase() : null, name: profile.name || "" };
  }

  if (provider === "line") {
    const r = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID, client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
      }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.id_token) throw new Error(tok.error_description || tok.error || "แลก token กับ LINE ไม่สำเร็จ");
    const payload = decodeJwtPayload(tok.id_token);
    if (!payload?.sub) throw new Error("ไม่พบข้อมูลผู้ใช้จาก LINE");
    return { identityId: payload.sub, email: null, name: payload.name || "" }; // LINE: ไม่ขอ scope email (ดูหัวไฟล์)
  }

  throw new Error("unknown provider");
}
