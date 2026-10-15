/* scripts/test-oauth.mjs — เข้าสู่ระบบผ่าน Google/Facebook/LINE (เพิ่ม 18 ก.ย. 69)
   ตรวจเฉพาะส่วนที่ทำงานได้แบบออฟไลน์ (เซ็น/ตรวจ state กัน CSRF, สร้าง authorize URL, ถอด JWT payload) —
   ไม่แตะเครือข่าย/DB จริง (แลกโค้ดจริงกับ Google/Facebook/LINE ต้องทดสอบมือหลัง deploy เท่านั้น) */
process.env.STAFF_SECRET = "test-secret-staff-ci-only";
process.env.SITE_URL = "https://suphan-legalaid.vercel.app";

import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  PROVIDERS, IDENTITY_COLUMN, makeOauthState, readOauthState,
  providerConfigured, authorizeUrl, redirectUri, decodeJwtPayload,
  oauthFlowCookieHeader, clearOauthFlowCookieHeader, oauthFlowCookieMatches,
} from "../api/_oauth.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

// ── provider/คอลัมน์ที่รองรับ ──
{
  ok(PROVIDERS.length === 3 && PROVIDERS.includes("google") && PROVIDERS.includes("facebook") && PROVIDERS.includes("line"), "ต้องรองรับ 3 ช่องทางตามที่บอสสั่ง (18 ก.ย. 69)");
  ok(IDENTITY_COLUMN.line === "line_uid", "LINE ต้องใช้คอลัมน์ line_uid เดิม (ผูกกับ #เชื่อม ที่มีอยู่แล้ว) ไม่ใช่คอลัมน์ใหม่");
  ok(IDENTITY_COLUMN.google === "google_sub" && IDENTITY_COLUMN.facebook === "facebook_id", "Google/Facebook ต้องมีคอลัมน์ระบุตัวตนของตัวเอง");
}

// ── providerConfigured() อ่านจาก env ตรงตามที่ตั้งไว้ ──
{
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  ok(!providerConfigured("google"), "ยังไม่ตั้ง env ของ Google ต้องถือว่ายังไม่พร้อมใช้งาน");
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  ok(!providerConfigured("google"), "ตั้งแค่ client id อย่างเดียวยังไม่พอ ต้องมี secret คู่กันด้วย");
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  ok(providerConfigured("google"), "ตั้งครบทั้ง client id และ secret แล้วต้องถือว่าพร้อมใช้งาน");
  ok(!providerConfigured("unknown"), "provider ที่ไม่รู้จักต้องไม่ถือว่าพร้อมใช้งาน");
}

// ── state กัน CSRF (เซ็น/ตรวจ/หมดอายุ/ป้องกันปลอมแปลง/ผูกกับ provider) ──
{
  const state = makeOauthState("google");
  ok(state.split(".").length === 4, "state ต้องมี 4 ส่วน (provider.nonce.exp.sig)");

  const read = readOauthState(state);
  ok(read.ok && read.provider === "google", "อ่าน state ที่ถูกต้องต้องผ่าน และได้ provider ตรงกับตอนสร้าง");

  const parts = state.split(".");
  const forgedProvider = ["facebook", parts[1], parts[2], parts[3]].join(".");
  ok(!readOauthState(forgedProvider).ok, "แก้ provider ใน state โดยไม่มีลายเซ็นถูกต้องต้องใช้ไม่ได้ (กัน provider confusion)");

  const forgedExp = [parts[0], parts[1], String(Date.now() + 999 * 24 * 60 * 60 * 1000), parts[3]].join(".");
  ok(!readOauthState(forgedExp).ok, "ปลอมวันหมดอายุให้ยาวขึ้นโดยไม่มีลายเซ็นถูกต้องต้องใช้ไม่ได้");

  ok(!readOauthState("").ok, "state ว่างต้องไม่ผ่าน");
  ok(!readOauthState("a.b.c").ok, "state รูปแบบผิด (ไม่ครบ 4 ส่วน) ต้องไม่ผ่าน");

  // state ที่หมดอายุจริง — สร้างเองแบบ exp ติดลบ (จำลองด้วยการเซ็นค่า exp ที่ผ่านไปแล้วด้วยกลไกเดียวกัน)
  const nonce = crypto.randomBytes(12).toString("base64url");
  const expiredExp = Date.now() - 1000;
  const payload = `line.${nonce}.${expiredExp}`;
  const sig = crypto.createHmac("sha256", process.env.STAFF_SECRET).update(payload).digest("base64url");
  const expiredState = `${payload}.${sig}`;
  const expiredRead = readOauthState(expiredState);
  ok(!expiredRead.ok, "state ที่หมดเวลาจริงต้องใช้ไม่ได้");
}

// ── redirect_uri / authorize URL แต่ละ provider ──
{
  process.env.FACEBOOK_APP_ID = "fb-id"; process.env.FACEBOOK_APP_SECRET = "fb-secret";
  process.env.LINE_LOGIN_CHANNEL_ID = "line-id"; process.env.LINE_LOGIN_CHANNEL_SECRET = "line-secret";

  for (const provider of PROVIDERS) {
    const uri = redirectUri(provider);
    ok(uri === `https://suphan-legalaid.vercel.app/api/staff-auth?action=oauth-callback&provider=${provider}`, `redirect_uri ของ ${provider} ต้องชี้กลับ oauth-callback พร้อม provider ตรงตัว (ต้องเอาไปลงทะเบียนในคอนโซลของแต่ละเจ้าให้ตรงเป๊ะ)`);

    const state = makeOauthState(provider);
    const url = authorizeUrl(provider, state);
    ok(url.includes(encodeURIComponent(uri)) || url.includes(uri), `authorize URL ของ ${provider} ต้องแนบ redirect_uri ที่ถูกต้อง`);
    ok(url.includes(`state=${encodeURIComponent(state)}`) || url.includes(state), `authorize URL ของ ${provider} ต้องแนบ state กัน CSRF`);
  }
  ok(authorizeUrl("google", "s").startsWith("https://accounts.google.com/"), "Google ต้องพาไปหน้า accounts.google.com");
  ok(authorizeUrl("facebook", "s").startsWith("https://www.facebook.com/"), "Facebook ต้องพาไปหน้า facebook.com");
  ok(authorizeUrl("line", "s").startsWith("https://access.line.me/"), "LINE ต้องพาไปหน้า access.line.me");
  ok(!authorizeUrl("line", "s").includes("scope=profile+openid+email") && !authorizeUrl("line", "s").includes("email"), "LINE ต้องไม่ขอ scope email (ยังไม่ได้ยื่นขออนุมัติจาก LINE — ดูหัวไฟล์ _oauth.js)");
}

// ── ถอด JWT payload (ไม่ตรวจลายเซ็น — ดูเหตุผลในหัวไฟล์ _oauth.js) ──
{
  const payload = { sub: "user-123", email: "test@example.com", email_verified: true, name: "ทดสอบ ระบบ" };
  const fakeJwt = "header." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".sig";
  const decoded = decodeJwtPayload(fakeJwt);
  ok(decoded?.sub === "user-123" && decoded?.email === "test@example.com", "ถอด JWT payload ที่ถูกต้องต้องได้ค่าตรงกับที่เข้ารหัสไว้");
  ok(decoded?.name === "ทดสอบ ระบบ", "ต้องถอดภาษาไทยใน JWT payload ได้ถูกต้อง (UTF-8)");

  ok(decodeJwtPayload("") === null, "JWT ว่างต้องคืน null ไม่ throw");
  ok(decodeJwtPayload("not-a-jwt") === null, "JWT รูปแบบผิดต้องคืน null ไม่ throw");
  ok(decodeJwtPayload("a.{not-valid-base64url-json}.c") === null, "JWT ที่ payload ถอดรหัสไม่ได้ต้องคืน null ไม่ throw");
}

// ── คุกกี้ผูก state กับเบราว์เซอร์เดิม (กัน account-linking CSRF — ดูหัวไฟล์ _oauth.js) ──
{
  const state = makeOauthState("google");
  const header = oauthFlowCookieHeader(state);
  ok(header.includes("HttpOnly") && header.includes("Secure") && header.includes("SameSite=Lax"), "คุกกี้ oauth_flow ต้องเป็น HttpOnly+Secure+SameSite=Lax เหมือนคุกกี้เซสชัน");
  ok(header.includes(encodeURIComponent(state)), "คุกกี้ oauth_flow ต้องเก็บค่า state ที่ตรงกับที่ส่งให้ผู้ให้บริการ");

  const clearHeader = clearOauthFlowCookieHeader();
  ok(clearHeader.includes("Max-Age=0"), "เคลียร์คุกกี้ oauth_flow ต้องตั้ง Max-Age=0");

  ok(oauthFlowCookieMatches({ oauth_flow: state }, state), "คุกกี้ตรงกับ state ที่ได้รับกลับมาต้องผ่าน");
  ok(!oauthFlowCookieMatches({ oauth_flow: state }, makeOauthState("google")), "state คนละตัว (แม้ provider เดียวกัน) ต้องไม่ผ่าน");
  ok(!oauthFlowCookieMatches({}, state), "ไม่มีคุกกี้เลย (เช่น เบราว์เซอร์คนละตัวจากที่กด oauth-start) ต้องไม่ผ่าน — นี่คือด่านกัน account-linking CSRF");
  ok(!oauthFlowCookieMatches({ oauth_flow: "" }, state), "คุกกี้ว่างต้องไม่ผ่าน");
  ok(!oauthFlowCookieMatches({ oauth_flow: state }, ""), "state ว่างต้องไม่ผ่าน");
}

console.log(`✅ test-oauth.mjs: ${checked} checks passed`);
