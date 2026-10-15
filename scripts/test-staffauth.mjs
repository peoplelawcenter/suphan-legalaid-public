/* scripts/test-staffauth.mjs — ระบบล็อกอินเจ้าหน้าที่ด้วยอีเมล+รหัสผ่าน+OTP (ใหม่ 17 ก.ย. 69 รอบ 3)
   ตรวจเฉพาะส่วนที่ทำงานได้แบบออฟไลน์ (เซ็น/ตรวจ session token, แฮชรหัสผ่าน, แฮช/ตรวจ OTP) — ไม่แตะ DB
   จริง (การสมัคร/อนุมัติ/ล็อกอินเต็มรูปแบบต้องทดสอบผ่าน npm run smoke หรือมือหลัง deploy) */
process.env.STAFF_SECRET = "test-secret-staff-ci-only";

import assert from "node:assert/strict";
import {
  makeSessionToken, readSessionToken, SESSION_TTL_MS,
  hashPassword, verifyPassword,
  generateOtp, hashOtp, otpMatches, OTP_TTL_MS, OTP_MAX_ATTEMPTS,
  atLeast, escapeLikePattern,
} from "../api/_staffauth.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

// ── session token (เซ็น/ตรวจ/หมดอายุ/ป้องกันปลอมแปลง) ──
{
  const tok = makeSessionToken(42);
  ok(tok && tok.split(".").length === 3, "session token ต้องมี 3 ส่วน (staffId.exp.sig)");

  const read = readSessionToken(tok);
  ok(read.ok && read.staffId === 42, "อ่าน session token ที่ถูกต้องต้องผ่าน และได้ staffId เป็นตัวเลข");

  const [idPart, expPart, sigPart] = tok.split(".");
  ok(!readSessionToken([idPart + "9", expPart, sigPart].join(".")).ok, "แก้ staffId ใน token แล้วต้องใช้ไม่ได้");

  const forgedExp = [idPart, String(Date.now() + 999 * 24 * 60 * 60 * 1000), sigPart].join(".");
  ok(!readSessionToken(forgedExp).ok, "ปลอมวันหมดอายุให้ยาวขึ้นโดยไม่มีลายเซ็นถูกต้องต้องใช้ไม่ได้");

  const expiredTok = makeSessionToken(42, -1000); // หมดอายุไปแล้ว
  const expiredRead = readSessionToken(expiredTok);
  ok(!expiredRead.ok && expiredRead.expired, "session token หมดอายุต้องคืน expired:true");

  ok(!readSessionToken("").ok, "token ว่างต้องไม่ผ่าน");
  ok(!readSessionToken("a.b").ok, "token รูปแบบผิด (ไม่ครบ 3 ส่วน) ต้องไม่ผ่าน");
  ok(SESSION_TTL_MS === 12 * 60 * 60 * 1000, "อายุเซสชันต้องเป็น 12 ชม. ตามมติเจ้าของ");
}

// ── รหัสผ่าน (bcryptjs) ──
{
  const hash = await hashPassword("correct-horse-battery-staple");
  ok(hash && hash !== "correct-horse-battery-staple", "แฮชต้องไม่ใช่รหัสผ่านดิบ");
  ok(await verifyPassword("correct-horse-battery-staple", hash), "รหัสผ่านถูกต้องต้องตรวจผ่าน");
  ok(!(await verifyPassword("wrong-password", hash)), "รหัสผ่านผิดต้องตรวจไม่ผ่าน");
  ok(!(await verifyPassword("correct-horse-battery-staple", null)), "ไม่มีแฮชเลยต้องตรวจไม่ผ่าน (กัน null crash)");
}

// ── OTP (สร้าง/แฮช/ตรวจ) ──
{
  const code = generateOtp();
  ok(/^\d{6}$/.test(code), "OTP ต้องเป็นตัวเลข 6 หลักเสมอ (รวมกรณีขึ้นต้นด้วย 0)");

  const hash = hashOtp(code);
  ok(hash !== code, "แฮช OTP ต้องไม่ใช่รหัสดิบ");
  ok(otpMatches(code, hash), "OTP ถูกต้องต้องตรวจผ่าน");
  ok(!otpMatches("000000", hash), "OTP ผิดต้องตรวจไม่ผ่าน (เว้นแต่ชนกันพอดี ซึ่งโอกาสต่ำมาก)");
  ok(!otpMatches(code, null), "ไม่มีแฮชเลยต้องตรวจไม่ผ่าน (กัน null crash)");

  ok(OTP_TTL_MS === 10 * 60 * 1000, "อายุ OTP ต้องเป็น 10 นาทีตามสเปก");
  ok(OTP_MAX_ATTEMPTS === 5, "เพดานจำนวนครั้งที่กรอก OTP ผิดต้องเป็น 5 ตามสเปก");
}

// ── บทบาท ──
{
  ok(atLeast("admin", "admin"), "admin ต้องผ่านเงื่อนไขต้องการ admin");
  ok(atLeast("admin", "staff"), "admin ต้องผ่านเงื่อนไขต้องการ staff ด้วย (สิทธิ์สูงกว่าครอบคลุม)");
  ok(atLeast("staff", "staff"), "staff ต้องผ่านเงื่อนไขต้องการ staff");
  ok(!atLeast("staff", "admin"), "staff ต้องไม่ผ่านเงื่อนไขต้องการ admin");
  ok(!atLeast(null, "staff"), "ไม่มีบทบาทเลยต้องไม่ผ่านเงื่อนไขใดๆ");
}

// ── escape wildcard ของ SQL LIKE/ILIKE (เพิ่ม 18 ก.ย. 69 หลังรีวิวความปลอดภัยอัตโนมัติเจอ
//    .ilike("email", ...) ทุกจุดใน staff-auth.js ไม่ escape มาก่อน — ดูหัวฟังก์ชัน escapeLikePattern) ──
{
  ok(escapeLikePattern("john_doe@example.com") === "john\\_doe@example.com", "_ ต้องถูก escape เป็น \\_ (มิฉะนั้น ILIKE ตีความเป็น wildcard \"ตัวอักษรใดก็ได้ 1 ตัว\")");
  ok(escapeLikePattern("100%sure@example.com") === "100\\%sure@example.com", "% ต้องถูก escape เป็น \\% (มิฉะนั้น ILIKE ตีความเป็น wildcard \"ตัวอักษรใดก็ได้ 0 ตัวขึ้นไป\")");
  ok(escapeLikePattern("a\\_b@example.com") === "a\\\\\\_b@example.com", "backslash ที่มีอยู่ก่อนต้อง escape เป็น \\\\ ก่อนเสมอ ไม่งั้น \\_ ที่ผู้ใช้พิมพ์เองจะกลายเป็น escape sequence โดยไม่ตั้งใจ");
  ok(escapeLikePattern("plain@example.com") === "plain@example.com", "อีเมลที่ไม่มีอักขระพิเศษต้องไม่ถูกแก้ไขเลย");
  ok(escapeLikePattern("%") === "\\%" && escapeLikePattern("_") === "\\_", "ตัวอักขระ wildcard เดี่ยวๆ ต้องถูก escape ครบ (กันกรณี identity.email จาก OAuth เป็นค่าที่ควบคุมไม่ได้เต็มที่)");
}

// ═══ 5 ต.ค. 69: staff-login.html รองรับ ?next= เฉพาะ path ภายใน (กัน open redirect) — ดึงฟังก์ชันจริงจากหน้าเว็บมาทดสอบ ═══
{
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../public/staff-login.html", import.meta.url), "utf8");
  const src = (/function safeNextPath\(raw, origin\) \{[\s\S]*?\n\} \/\/ end safeNextPath/.exec(page) || [])[0];
  ok(!!src, "staff-login.html มีฟังก์ชัน safeNextPath");
  const safeNextPath = new Function(src + "\nreturn safeNextPath;")(); // ขึ้นบรรทัดใหม่ก่อน return — src จบด้วยคอมเมนต์ // end safeNextPath
  const O = "https://suphan-legalaid.vercel.app";
  ok(safeNextPath("/cms.html", O) === "/cms.html", "next=/cms.html ผ่าน");
  ok(safeNextPath("/cms.html#list:posts:news", O) === "/cms.html#list:posts:news", "คง hash ของ CMS ไว้");
  ok(safeNextPath("/staff.html?tab=profile", O) === "/staff.html?tab=profile", "คง query ภายใน");
  for (const bad of ["//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example", "/\\/evil.example", "https://evil.example", "javascript:alert(1)",
    "evil.example", "/ /evil", "/%0d%0aSet-Cookie", "/api/staff-auth?action=logout", "/staff-login.html?next=//evil", "", "/a@evil.example", "/x\n", "/x\t", "/" + "a".repeat(400)]) {
    ok(safeNextPath(bad, O) === null, `next อันตรายถูกปฏิเสธ: ${JSON.stringify(bad).slice(0, 40)}`);
  }
  ok(/location\.href = NEXT_PATH/.test(page) && !/location\.href = "\/staff\.html"/.test(page), "ล็อกอินสำเร็จไป NEXT_PATH (ค่าเริ่มต้น /staff.html)");
}

console.log(`✅ test-staffauth.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
