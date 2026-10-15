/* api/staff-auth.js — สมัครสมาชิก/ยืนยัน OTP/เข้าสู่ระบบ/ออกจากระบบ/ลืมรหัสผ่านของเจ้าหน้าที่ (ใหม่
   17 ก.ย. 69 รอบ 3) เอนด์พอยต์นี้ "ไม่ต้องมีสิทธิ์เจ้าหน้าที่มาก่อน" ต่างจาก api/staff.js ที่บังคับ
   session ถูกต้องทุก action — แยกไฟล์เพราะ chicken-and-egg (จะเข้าสู่ระบบได้ต้องยังไม่ได้ล็อกอินอยู่ก่อน)

   OTP ส่งทางอีเมลเท่านั้น (มติเจ้าของ 17 ก.ย. 69 — ฟรี ใช้ระบบเมลที่มีอยู่แล้ว ไม่ต้องสมัครผู้ให้บริการ
   SMS เพิ่ม) ยืนยันแค่ตอนสมัครครั้งแรกเท่านั้น ไม่ใช่ 2FA ทุกครั้งที่ล็อกอิน (มติเจ้าของเช่นกัน) — field
   otp_hash/otp_expires_at/otp_attempts บนตาราง staff ใช้ร่วมกัน 2 จุด: ยืนยันอีเมลตอนสมัคร และลืมรหัสผ่าน
   (ใช้ซ้ำได้เพราะความหมายเดียวกัน "พิสูจน์ว่าเป็นเจ้าของอีเมลนี้จริงตอนนี้")

   ✅ เพิ่ม 18 ก.ย. 69 — action=oauth-start/oauth-callback (GET ไม่ใช่ POST เพราะเป็นการนำทางเบราว์เซอร์
   เต็มหน้า) สำหรับปุ่ม "เข้าสู่ระบบด้วย Google/Facebook/LINE" อยู่ในไฟล์นี้เพราะเหตุผลเดียวกับ action อื่น
   — ไม่ต้องมี session มาก่อนเรียกได้ ดูรายละเอียดโปรโตคอลที่ api/_oauth.js */
export const config = { api: { bodyParser: false } };

import { db } from "./_db.js";
import {
  hashPassword, verifyPassword, generateOtp, hashOtp, otpMatches,
  makeSessionToken, sessionCookieHeader, clearSessionCookieHeader,
  parseCookies, readSessionToken, COOKIE_NAME, escapeLikePattern,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS,
} from "./_staffauth.js";
import { sendMail } from "./_mailer.js";
import {
  PROVIDERS, IDENTITY_COLUMN, makeOauthState, readOauthState,
  providerConfigured, authorizeUrl, exchangeCodeForIdentity,
  oauthFlowCookieHeader, clearOauthFlowCookieHeader, oauthFlowCookieMatches,
} from "./_oauth.js";

function json(res, status, body, extraHeaders = {}) {
  res.status(status);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}
function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

/* กันยิงรัว — best-effort ต่ออินสแตนซ์ (แนวเดียวกับ shotRateLimited ของ api/form.js) */
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}

function siteUrl() {
  return process.env.SITE_URL || "https://suphan-legalaid.vercel.app";
}
function redirectTo(res, url, extraHeaders = {}) {
  res.statusCode = 302;
  res.setHeader("Location", url);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end();
}
// เจ้าของ session cookie ปัจจุบัน (ถ้ามีและยังใช้งานอยู่) — ใช้แยก "โหมดล็อกอิน" (ยังไม่มี session)
// ออกจาก "โหมดเชื่อมบัญชีเพิ่ม" (มี session อยู่แล้ว กดปุ่มจากหน้าโปรไฟล์) บน oauth-callback เดียวกัน
async function currentSessionStaffId(req) {
  const cookies = parseCookies(req);
  const read = readSessionToken(cookies[COOKIE_NAME]);
  if (!read.ok) return null;
  const { data } = await db().from("staff").select("id,active").eq("id", read.staffId).maybeSingle();
  if (!data || !data.active) return null;
  return data.id;
}

/* ═══ เข้าสู่ระบบ/สมัครสมาชิก/เชื่อมบัญชีผ่าน Google/Facebook/LINE (เพิ่ม 18 ก.ย. 69) — เป็น GET เพราะ
   เป็นการนำทางเบราว์เซอร์เต็มหน้า (redirect ไปผู้ให้บริการแล้วเด้งกลับ) ไม่ใช่ fetch แบบ action อื่นในไฟล์
   นี้ ตอบกลับเป็น 302 เสมอ ไม่ใช่ JSON — ข้อผิดพลาดทุกกรณีส่งกลับไปที่ staff-login.html พร้อม query
   ?oautherror=... ให้หน้าเว็บอ่านแล้วแสดงข้อความเอง (ดู public/staff-login.html) */
async function handleOauth(req, res, action, q) {
  const provider = q.get("provider");
  const loginUrl = (qs) => `${siteUrl()}/staff-login.html${qs ? "?" + qs : ""}`;

  if (!PROVIDERS.includes(provider)) return redirectTo(res, loginUrl("oautherror=unknown_provider"));

  if (action === "oauth-start") {
    if (!providerConfigured(provider)) return redirectTo(res, loginUrl(`oautherror=not_configured&provider=${provider}`));
    const state = makeOauthState(provider);
    // ผูก state กับเบราว์เซอร์นี้ด้วยคุกกี้ชั่วคราว (กัน account-linking CSRF — ดูหัวข้อในหัวไฟล์ _oauth.js)
    return redirectTo(res, authorizeUrl(provider, state), { "Set-Cookie": oauthFlowCookieHeader(state) });
  }

  // action === "oauth-callback" — ทุกทางออกจากนี้ต้องเคลียร์คุกกี้ oauth_flow เสมอ (กันใช้ state ซ้ำ)
  const doneCookies = { "Set-Cookie": clearOauthFlowCookieHeader() };
  if (q.get("error")) return redirectTo(res, loginUrl(`oautherror=denied&provider=${provider}`), doneCookies); // ผู้ใช้กดยกเลิกฝั่งผู้ให้บริการ
  const state = q.get("state");
  if (!oauthFlowCookieMatches(parseCookies(req), state)) return redirectTo(res, loginUrl("oautherror=invalid_state"), doneCookies);
  const stateCheck = readOauthState(state);
  if (!stateCheck.ok || stateCheck.provider !== provider) return redirectTo(res, loginUrl("oautherror=invalid_state"), doneCookies);
  if (!providerConfigured(provider)) return redirectTo(res, loginUrl(`oautherror=not_configured&provider=${provider}`), doneCookies);

  let identity;
  try {
    identity = await exchangeCodeForIdentity(provider, q.get("code"));
  } catch (e) {
    console.error("oauth exchange failed", provider, e);
    return redirectTo(res, loginUrl(`oautherror=exchange_failed&provider=${provider}`), doneCookies);
  }

  const col = IDENTITY_COLUMN[provider];
  const linkStaffId = await currentSessionStaffId(req);

  if (linkStaffId) {
    // ═══ โหมดเชื่อมบัญชีเพิ่ม (มี session ที่ใช้งานได้อยู่แล้ว) ═══
    const { data: taken } = await db().from("staff").select("id").eq(col, identity.identityId).maybeSingle();
    if (taken && taken.id !== linkStaffId) {
      return redirectTo(res, `${siteUrl()}/staff.html?tab=settings&topic=links&linkerror=taken&provider=${provider}`, doneCookies);
    }
    await db().from("staff").update({ [col]: identity.identityId }).eq("id", linkStaffId);
    return redirectTo(res, `${siteUrl()}/staff.html?tab=settings&topic=links&linked=${provider}`, doneCookies);
  }

  // ═══ โหมดเข้าสู่ระบบ/สมัครสมาชิก (ยังไม่มี session) ═══
  let { data: row } = await db().from("staff").select("id,role,active,approved_at").eq(col, identity.identityId).maybeSingle();

  if (!row && identity.email) {
    // อีเมลนี้ผู้ให้บริการยืนยันแล้ว (ดูหัวไฟล์ _oauth.js) — ผูกเข้าบัญชีเดิมที่สมัครด้วยอีเมลนี้ไว้ก่อนได้เลย
    const { data: found } = await db().from("staff").select("id,role,active,approved_at").ilike("email", escapeLikePattern(identity.email)).maybeSingle();
    if (found) {
      row = found;
      await db().from("staff").update({ [col]: identity.identityId, email_verified_at: new Date().toISOString() }).eq("id", row.id);
    }
  }

  // ⛔ เปลี่ยน 18 ก.ย. 69 — ออก session ทันทีที่พิสูจน์ตัวตนสำเร็จ ไม่ว่าจะเป็นบัญชีเดิม (รออนุมัติ/ถูกระงับ
  // ก็ตาม) หรือบัญชีใหม่ที่เพิ่งสร้าง (Google/Facebook ยืนยันอีเมลมาให้เทียบเท่า OTP ของเราเอง) — บอสสั่ง
  // "เข้าระบบได้เลย แต่ยังดูข้อมูล/ทำอะไรไม่ได้จนกว่าแอดมินจะอนุมัติ" เหมือน action=login ด้านล่าง ด่านจริง
  // ย้ายไปบล็อกที่ whoFromSession() ทุก action ใน api/staff.js แทน (ดู api/_staffauth.js)
  if (!row) {
    if (provider === "line") {
      // LINE ไม่มีอีเมลยืนยันให้สร้างบัญชีใหม่ไม่ได้ (ดูหัวไฟล์ _oauth.js) — ต้องเข้าด้วยอีเมลก่อนแล้วไปเชื่อมที่โปรไฟล์
      return redirectTo(res, loginUrl("oautherror=line_not_linked"), doneCookies);
    }
    if (!identity.email) return redirectTo(res, loginUrl(`oautherror=no_email&provider=${provider}`), doneCookies);
    const { data: created, error } = await db().from("staff").insert({
      email: identity.email, display_name: (identity.name || identity.email).slice(0, 100),
      [col]: identity.identityId, email_verified_at: new Date().toISOString(),
      role: "staff", active: false,
    }).select("id").single();
    if (error) {
      console.error("oauth create staff failed", error);
      return redirectTo(res, loginUrl(`oautherror=create_failed&provider=${provider}`), doneCookies);
    }
    const newToken = makeSessionToken(created.id);
    return redirectTo(res, `${siteUrl()}/staff.html`, { "Set-Cookie": [clearOauthFlowCookieHeader(), sessionCookieHeader(newToken)] });
  }

  const token = makeSessionToken(row.id);
  return redirectTo(res, `${siteUrl()}/staff.html`, { "Set-Cookie": [clearOauthFlowCookieHeader(), sessionCookieHeader(token)] });
}

async function sendOtpMail(email, code, purpose) {
  const subject = purpose === "reset" ? "รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่" : "รหัสยืนยันสมัครสมาชิกเจ้าหน้าที่";
  const text = [
    `รหัสยืนยัน (OTP) ของท่านคือ: ${code}`,
    ``,
    `รหัสนี้ใช้ได้ภายใน 10 นาที ห้ามให้ผู้อื่นทราบรหัสนี้`,
    `หากท่านไม่ได้เป็นผู้ทำรายการนี้ ไม่ต้องดำเนินการใดๆ`,
    ``,
    `ศูนย์ช่วยเหลือประชาชนทางกฎหมาย อบจ.สุพรรณบุรี`,
  ].join("\n");
  return sendMail({ to: email, subject, text });
}

export default async function handler(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const action = req.query?.action || q.get("action");

  // เข้าสู่ระบบ/เชื่อมบัญชีผ่าน Google/Facebook/LINE — เป็น GET เพราะเป็นการนำทางเบราว์เซอร์เต็มหน้า
  // (ปุ่มในหน้าเว็บเป็น <a href> ธรรมดา ไม่ใช่ fetch) แยกออกจาก action อื่นทั้งหมดที่เป็น POST+JSON
  if (action === "oauth-start" || action === "oauth-callback") {
    if (req.method !== "GET") return json(res, 405, { ok: false, error: "method not allowed" });
    try { return await handleOauth(req, res, action, q); }
    catch (e) {
      console.error("staff-auth.js oauth error", e);
      return redirectTo(res, `${siteUrl()}/staff-login.html?oautherror=internal`, { "Set-Cookie": clearOauthFlowCookieHeader() });
    }
  }

  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });

  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: "bad json" }); }

  const ip = clientIp(req);

  try {
    // ═══ สมัครสมาชิก — สร้างแถว staff ใหม่ (active=false รออนุมัติ) + ส่ง OTP ยืนยันอีเมล ═══
    if (action === "register") {
      if (rateLimited("register:" + ip, 8, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: "สมัครถี่เกินไป กรุณารอสักครู่" });
      const email = normEmail(body.email);
      const name = String(body.name || "").trim().slice(0, 100);
      const password = String(body.password || "");
      if (!validEmail(email)) return json(res, 400, { ok: false, error: "รูปแบบอีเมลไม่ถูกต้อง" });
      if (!name) return json(res, 400, { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" });
      if (password.length < 8) return json(res, 400, { ok: false, error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });

      const { data: existing } = await db().from("staff").select("id,email_verified_at,approved_at").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (existing && existing.email_verified_at) {
        // มีบัญชีที่ยืนยันอีเมลแล้ว (ไม่ว่าจะอนุมัติแล้วหรือรออนุมัติ) — ห้ามสมัครทับ ให้ไปเข้าสู่ระบบ/ลืมรหัสผ่านแทน
        return json(res, 400, { ok: false, error: "อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ หรือใช้ \"ลืมรหัสผ่าน\"" });
      }

      const passwordHash = await hashPassword(password);
      const code = generateOtp();
      const otpHash = hashOtp(code);
      const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

      // ยังไม่เคยยืนยันอีเมลมาก่อน (แถวใหม่ หรือแถวเก่าที่สมัครค้างไว้ไม่จบ) — upsert ทับได้ปลอดภัย
      const { error } = await db().from("staff").upsert(
        {
          ...(existing ? { id: existing.id } : {}),
          email, display_name: name, password_hash: passwordHash,
          otp_hash: otpHash, otp_expires_at: otpExpiresAt, otp_attempts: 0,
          role: "staff", active: false,
        },
        { onConflict: "id" }
      );
      if (error) throw error;

      const mailed = await sendOtpMail(email, code, "register");
      return json(res, 200, { ok: true, mailed });
    }

    // ═══ ยืนยัน OTP หลังสมัคร ═══
    if (action === "verify-otp") {
      const email = normEmail(body.email);
      const code = String(body.code || "").trim();
      if (rateLimited("verify:" + ip, 15, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: "ลองถี่เกินไป กรุณารอสักครู่" });

      const { data: row } = await db().from("staff").select("id,otp_hash,otp_expires_at,otp_attempts,email_verified_at").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (!row || !row.otp_hash) return json(res, 400, { ok: false, error: "ไม่พบคำขอยืนยันสำหรับอีเมลนี้ กรุณาสมัครสมาชิกใหม่" });
      if (row.otp_attempts >= OTP_MAX_ATTEMPTS) return json(res, 400, { ok: false, error: "กรอกรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่" });
      if (!row.otp_expires_at || Date.now() > new Date(row.otp_expires_at).getTime()) return json(res, 400, { ok: false, error: "รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่" });

      if (!otpMatches(code, row.otp_hash)) {
        await db().from("staff").update({ otp_attempts: row.otp_attempts + 1 }).eq("id", row.id);
        return json(res, 400, { ok: false, error: `รหัสไม่ถูกต้อง เหลือโอกาสอีก ${OTP_MAX_ATTEMPTS - row.otp_attempts - 1} ครั้ง` });
      }

      // ═══ บูตแอดมินคนแรกอัตโนมัติ (แนวเดียวกับ SEED_ADMIN_LINE_UID เดิม สลับมาเป็นอีเมล) — เฉพาะตอนยัง
      // ไม่มีแอดมินที่เคยอนุมัติจริงในระบบเลยเท่านั้น กันมีคนอ้างอีเมลนี้ซ้ำหลังมีแอดมินจริงแล้ว ═══
      const seedEmail = normEmail(process.env.SEED_ADMIN_EMAIL || "");
      let autoApproved = false;
      if (seedEmail && seedEmail === email) {
        const { count } = await db().from("staff").select("*", { count: "exact", head: true }).eq("role", "admin").not("approved_at", "is", null);
        if (!count) autoApproved = true;
      }

      const patch = { email_verified_at: new Date().toISOString(), otp_hash: null, otp_expires_at: null, otp_attempts: 0 };
      if (autoApproved) { patch.role = "admin"; patch.active = true; patch.approved_at = new Date().toISOString(); }
      const { error } = await db().from("staff").update(patch).eq("id", row.id);
      if (error) throw error;

      return json(res, 200, { ok: true, approved: autoApproved, pendingApproval: !autoApproved });
    }

    // ═══ ขอรหัส OTP ใหม่ (สมัครสมาชิกค้างอยู่ หรือใช้ร่วมกับลืมรหัสผ่านก็ได้ผ่าน request-reset) ═══
    if (action === "resend-otp") {
      const email = normEmail(body.email);
      if (rateLimited("resend:" + email, 3, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: "ขอรหัสถี่เกินไป กรุณารอสักครู่ก่อนขอใหม่" });
      const { data: row } = await db().from("staff").select("id,email_verified_at").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (!row || row.email_verified_at) return json(res, 200, { ok: true }); // ไม่ยืนยันว่ามี/ไม่มีบัญชี กันเดาอีเมล
      const code = generateOtp();
      await db().from("staff").update({ otp_hash: hashOtp(code), otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(), otp_attempts: 0 }).eq("id", row.id);
      await sendOtpMail(email, code, "register");
      return json(res, 200, { ok: true });
    }

    // ═══ เข้าสู่ระบบ ═══
    if (action === "login") {
      const email = normEmail(body.email);
      const password = String(body.password || "");
      if (rateLimited("login:" + ip, 10, 10 * 60 * 1000) || rateLimited("login:" + email, 8, 10 * 60 * 1000)) {
        return json(res, 429, { ok: false, error: "เข้าสู่ระบบผิดถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" });
      }
      const generic = { ok: false, error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
      const { data: row } = await db().from("staff").select("id,role,active,password_hash,email_verified_at,approved_at").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (!row || !row.password_hash) return json(res, 401, generic);
      if (!(await verifyPassword(password, row.password_hash))) return json(res, 401, generic);
      if (!row.email_verified_at) return json(res, 401, { ok: false, error: "ยังไม่ได้ยืนยันอีเมล กรุณายืนยัน OTP ก่อน" });

      // ⛔ เปลี่ยน 18 ก.ย. 69 — ออก session ทันทีที่พิสูจน์ตัวตนสำเร็จ (อีเมล+รหัสผ่านถูกต้อง+ยืนยันแล้ว) ไม่
      // บล็อกที่ตอนล็อกอินอีกต่อไปแม้ยังไม่ได้รับอนุมัติ/ถูกระงับสิทธิ์ก็ตาม — บอสสั่ง "เข้าระบบได้เลย แต่ยัง
      // ดูข้อมูล/ทำอะไรไม่ได้จนกว่าแอดมินจะอนุมัติ" ด่านจริงย้ายไปบล็อกที่ whoFromSession() ทุก action ใน
      // api/staff.js แทน (ดูหัวข้อใน api/_staffauth.js) — session cookie เองไม่มีสิทธิ์อะไรจนกว่าจะผ่านด่านนั้น
      const token = makeSessionToken(row.id);
      return json(res, 200, {
        ok: true, role: row.role,
        pendingApproval: !row.approved_at,
        suspended: !!row.approved_at && !row.active,
      }, { "Set-Cookie": sessionCookieHeader(token) });
    }

    // ═══ ออกจากระบบ ═══
    if (action === "logout") {
      return json(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookieHeader() });
    }

    // ═══ ลืมรหัสผ่าน — ขอ OTP (เฉพาะบัญชีที่อนุมัติ+ใช้งานอยู่จริง แต่ตอบ ok เสมอกันเดาว่าอีเมลมีจริงไหม) ═══
    if (action === "request-reset") {
      const email = normEmail(body.email);
      if (rateLimited("reset:" + email, 3, 10 * 60 * 1000)) return json(res, 200, { ok: true }); // เงียบไว้เหมือนสำเร็จ กันเดาอีเมลจากจังหวะตอบ
      const { data: row } = await db().from("staff").select("id,active,approved_at").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (row && row.active && row.approved_at) {
        const code = generateOtp();
        await db().from("staff").update({ otp_hash: hashOtp(code), otp_expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(), otp_attempts: 0 }).eq("id", row.id);
        await sendOtpMail(email, code, "reset");
      }
      return json(res, 200, { ok: true });
    }

    // ═══ ตั้งรหัสผ่านใหม่หลังยืนยัน OTP ═══
    if (action === "reset-password") {
      const email = normEmail(body.email);
      const code = String(body.code || "").trim();
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8) return json(res, 400, { ok: false, error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
      if (rateLimited("resetverify:" + ip, 15, 10 * 60 * 1000)) return json(res, 429, { ok: false, error: "ลองถี่เกินไป กรุณารอสักครู่" });

      const { data: row } = await db().from("staff").select("id,otp_hash,otp_expires_at,otp_attempts").ilike("email", escapeLikePattern(email)).maybeSingle();
      if (!row || !row.otp_hash) return json(res, 400, { ok: false, error: "ไม่พบคำขอตั้งรหัสผ่านใหม่สำหรับอีเมลนี้" });
      if (row.otp_attempts >= OTP_MAX_ATTEMPTS) return json(res, 400, { ok: false, error: "กรอกรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาขอรหัสใหม่" });
      if (!row.otp_expires_at || Date.now() > new Date(row.otp_expires_at).getTime()) return json(res, 400, { ok: false, error: "รหัสหมดอายุแล้ว กรุณาขอรหัสใหม่" });
      if (!otpMatches(code, row.otp_hash)) {
        await db().from("staff").update({ otp_attempts: row.otp_attempts + 1 }).eq("id", row.id);
        return json(res, 400, { ok: false, error: `รหัสไม่ถูกต้อง เหลือโอกาสอีก ${OTP_MAX_ATTEMPTS - row.otp_attempts - 1} ครั้ง` });
      }

      const passwordHash = await hashPassword(newPassword);
      const { error } = await db().from("staff").update({ password_hash: passwordHash, otp_hash: null, otp_expires_at: null, otp_attempts: 0 }).eq("id", row.id);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { ok: false, error: "ไม่รู้จัก action นี้" });
  } catch (e) {
    console.error("staff-auth.js error", e);
    return json(res, 500, { ok: false, error: e.message || "ระบบขัดข้องชั่วคราว" });
  }
}
