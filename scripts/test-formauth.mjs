/* scripts/test-formauth.mjs — ลิงก์เฉพาะบุคคลของฟอร์มประชาชน (consult/complaint/appointment/addevidence)
   ต้องกันของปลอม/ยืดอายุเอง/สลับฟอร์มได้จริง ไม่ใช่แค่ "ดูเหมือนทำงาน"
   (ส่วนเจ้าหน้าที่ย้ายไป test-staffauth.mjs แยกแล้วตั้งแต่ 17 ก.ย. 69 รอบ 3 — เปลี่ยนจากลิงก์ ?k= เป็น
   session cookie หลังระบบล็อกอินอีเมล+รหัสผ่าน+OTP) */
process.env.FORM_SECRET = "test-secret-form-ci-only";

import assert from "node:assert/strict";
import { makeFormToken, readFormToken, FORM_TOKEN_TTL_MS } from "../api/_formauth.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

// ── _formauth.js ──
{
  const uid = "U1234567890abcdef1234567890abcdef";
  const tok = makeFormToken(uid, "consult");
  ok(tok && tok.split(".").length === 4, "โทเคนต้องมี 4 ส่วน (uid.formType.exp.sig)");

  const read = readFormToken(tok, "consult");
  ok(read.ok && read.uid === uid && read.formType === "consult", "อ่านโทเคนที่ถูกต้องต้องผ่าน");

  const wrongType = readFormToken(tok, "complaint");
  ok(!wrongType.ok, "ลิงก์ฟอร์มปรึกษาต้องใช้กับฟอร์มร้องเรียนไม่ได้");

  const [uidPart, ftPart, expPart, sigPart] = tok.split(".");
  const tampered = [uidPart + "x", ftPart, expPart, sigPart].join(".");
  ok(!readFormToken(tampered).ok, "แก้ uid ในลิงก์แล้วต้องใช้ไม่ได้");

  const forgedExp = [uidPart, ftPart, String(Date.now() + 999 * 24 * 60 * 60 * 1000), sigPart].join(".");
  ok(!readFormToken(forgedExp).ok, "ปลอมวันหมดอายุให้ยาวขึ้นโดยไม่มีลายเซ็นถูกต้องต้องใช้ไม่ได้");

  const expiredTok = makeFormToken(uid, "consult", -1000); // หมดอายุไปแล้ว
  const expiredRead = readFormToken(expiredTok, "consult");
  ok(!expiredRead.ok && expiredRead.expired, "โทเคนหมดอายุต้องคืน expired:true");

  ok(!readFormToken("").ok, "โทเคนว่างต้องไม่ผ่าน");
  ok(!readFormToken("a.b.c").ok, "โทเคนรูปแบบผิด (ไม่ครบ 4 ส่วน) ต้องไม่ผ่าน");
  ok(FORM_TOKEN_TTL_MS === 30 * 60 * 1000, "อายุลิงก์ฟอร์มต้องเป็น 30 นาทีตามสเปก");
}

console.log(`✅ test-formauth.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
