/* scripts/test-broadcast.mjs — ตรวจหน้าส่งโปสเตอร์ข่าวถึงเพื่อนทุกคน (broadcast.html + api/_broadcast.js)
   แบบออฟไลน์ ไม่ต่อเน็ต ไม่แตะ DB/ไลน์จริง — ส่วนที่ต้องต่อของจริง (อัปโหลด/ไลน์ตรวจข้อความ) ตรวจบน prod
   ด้วย action=bc-check ซึ่งให้ไลน์ตรวจรูปแบบ "โดยไม่ส่ง" (ห้ามทดสอบด้วยการส่งจริงถึงประชาชน — กฎข้อ 5) */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isOwnPosterPath, normalizeLink, normalizeDraft, isRetryKey, sniffImage, totalSizeFrom,
  buildBroadcastMessages, MAX_IMAGES, MAX_CAPTION, MAX_LINK,
} from "../api/_broadcast.js";
import { classifyLineError, clampMessages, assertFlexSafe, yyyymmddJst } from "../api/_lineapi.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checked++; }

// ─── path รูปต้องเป็นของแอดมินคนที่ส่ง + ตรงรูปแบบที่เซิร์ฟเวอร์ออกให้เท่านั้น ───
const P = (id, ext = "jpg") => `bc/${id}/1790000000000-0123456789abcdef.${ext}`;
ok(isOwnPosterPath(P(7), 7), "path ของตัวเองต้องผ่าน");
ok(isOwnPosterPath(P(7, "png"), "7"), "png + staffId เป็น string ต้องผ่าน");
ok(!isOwnPosterPath(P(8), 7), "path ของแอดมินคนอื่นต้องไม่ผ่าน");
ok(!isOwnPosterPath("bc/7/../8/1790000000000-0123456789abcdef.jpg", 7), "path traversal ต้องไม่ผ่าน");
ok(!isOwnPosterPath("staff-7/1790000000000-0123456789abcdef.jpg", 7), "path ของ bucket หลักฐานต้องไม่ผ่าน");
ok(!isOwnPosterPath(P(7, "gif"), 7), "นามสกุลอื่นนอกจาก jpg/png ต้องไม่ผ่าน");
ok(!isOwnPosterPath("", 7) && !isOwnPosterPath(null, 7), "ค่าว่างต้องไม่ผ่าน");

// ─── ลิงก์ใต้รูป: uri action ของไลน์รับเฉพาะ ASCII (บั๊กจริง 16 ก.ย. 69 map_url ภาษาไทยดิบ) ───
eq(normalizeLink("").link, null, "ไม่ใส่ลิงก์ = null");
eq(normalizeLink("www.suphanburi.go.th").link, "https://www.suphanburi.go.th/", "พิมพ์แค่โดเมน = เติม https:// ให้");
{
  const r = normalizeLink("https://example.com/ข่าว ประชาสัมพันธ์?q=กฎหมาย#หัวข้อ");
  ok(r.ok && /^[\x21-\x7e]+$/.test(r.link), "ภาษาไทย/ช่องว่างในลิงก์ต้องถูก encode เป็น ASCII ล้วน: " + r.link);
  assertFlexSafe({ type: "uri", uri: r.link }); checked++;
}
ok(!normalizeLink("javascript:alert(1)").ok, "javascript: ต้องไม่ผ่าน");
ok(!normalizeLink("ftp://example.com/a").ok, "ftp: ต้องไม่ผ่าน");
ok(!normalizeLink("ไม่ใช่ลิงก์").ok, "ข้อความธรรมดาต้องไม่ผ่าน");
ok(!normalizeLink("https://example.com/" + "a".repeat(MAX_LINK)).ok, "ลิงก์ยาวเกินเพดานต้องไม่ผ่าน");
ok(normalizeLink("http://example.com").ok, "http:// ยอมรับ (ไลน์รองรับ)");

// ─── ตรวจร่างที่หน้าเว็บส่งมา ───
const img = (id) => ({ orig: P(id), preview: `bc/${id}/1790000000001-0123456789abcdef.jpg` });
ok(!normalizeDraft({ images: [] }, 7).ok, "ไม่มีรูปต้องไม่ผ่าน");
ok(!normalizeDraft({ images: Array(MAX_IMAGES + 1).fill(img(7)) }, 7).ok, `เกิน ${MAX_IMAGES} รูปต้องไม่ผ่าน`);
ok(!normalizeDraft({ images: [img(8)] }, 7).ok, "รูปของแอดมินคนอื่นต้องไม่ผ่าน");
ok(!normalizeDraft({ images: [img(7)], caption: "ก".repeat(MAX_CAPTION + 1) }, 7).ok, "ข้อความยาวเกินต้องไม่ผ่าน");
ok(!normalizeDraft({ images: [img(7)], link: "javascript:x" }, 7).ok, "ลิงก์อันตรายต้องไม่ผ่านทั้งร่าง");
{
  const d = normalizeDraft({ images: [{ orig: P(7) }], caption: "  บรรทัด1\r\nบรรทัด2  " }, 7);
  ok(d.ok, "ร่างปกติต้องผ่าน");
  eq(d.images[0].preview, P(7), "ไม่มีภาพย่อ = ใช้ต้นฉบับเป็นภาพย่อ");
  eq(d.caption, "บรรทัด1\nบรรทัด2", "ตัดช่องว่างหัวท้าย + แปลง CRLF");
  eq(d.notify, true, "ค่าเริ่มต้นมีเสียงแจ้งเตือน");
  eq(normalizeDraft({ images: [img(7)], notify: false }, 7).notify, false, "เลือกส่งเงียบได้");
}

// ─── รหัสกันส่งซ้ำ (X-Line-Retry-Key ต้องเป็น UUID) ───
ok(isRetryKey("123e4567-e89b-42d3-a456-426655440000"), "UUID ปกติต้องผ่าน");
ok(!isRetryKey("") && !isRetryKey("abc") && !isRetryKey("123e4567e89b42d3a456426655440000"), "ไม่ใช่ UUID ต้องไม่ผ่าน");

// ─── ตรวจหัวไฟล์จริง + ขนาดจาก Content-Range ───
eq(sniffImage([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "หัวไฟล์ JPEG");
eq(sniffImage([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png", "หัวไฟล์ PNG");
eq(sniffImage([0x47, 0x49, 0x46, 0x38]), null, "GIF ต้องไม่ผ่าน");
eq(sniffImage([0x25, 0x50, 0x44, 0x46]), null, "PDF ต้องไม่ผ่าน");
eq(totalSizeFrom(206, "bytes 0-15/734003", "16"), 734003, "ขนาดรวมจาก Content-Range");
eq(totalSizeFrom(200, null, "5000"), 5000, "เซิร์ฟเวอร์ไม่สน Range = ใช้ Content-Length");
eq(totalSizeFrom(206, null, "16"), null, "206 ไม่มี Content-Range = ไม่รู้ขนาด (ไม่เดาจาก Content-Length ของก้อนย่อย)");

// ─── ข้อความที่ส่งจริง ───
const U = (n) => ({ originalUrl: `https://x.supabase.co/storage/v1/object/public/posters/o${n}.jpg`, previewUrl: `https://x.supabase.co/storage/v1/object/public/posters/p${n}.jpg` });
{
  const m = buildBroadcastMessages({ images: [U(1)], caption: "", link: null });
  eq(m.length, 1, "รูปเดียวไม่มีข้อความ = 1 ข้อความ (ไม่มีการ์ดเปล่าต่อท้าย)");
  eq(m[0].type, "image", "เป็นข้อความชนิด image (เห็นเต็มใบ) ไม่ใช่หัวการ์ดที่ครอปรูป");
  eq(m[0].previewImageUrl, U(1).previewUrl, "ใช้ภาพย่อเป็น previewImageUrl");
  eq(buildBroadcastMessages({ images: [{ originalUrl: U(1).originalUrl }] })[0].previewImageUrl, U(1).originalUrl, "ไม่มีภาพย่อ = ใช้ต้นฉบับ");
}
{
  const m = buildBroadcastMessages({ images: [U(1), U(2), U(3), U(4)], caption: "ข่าว", link: "https://example.com/" });
  eq(m.length, 5, "4 รูป + การ์ด = 5 ข้อความ พอดีเพดานต่อคำขอของไลน์");
  ok(m.slice(0, 4).every((x, i) => x.originalContentUrl === U(i + 1).originalUrl), "รูปเรียงตามลำดับที่แอดมินจัด");
  eq(m[4].type, "flex", "ข้อความใต้รูปเป็นการ์ดต่อท้ายรูป");
  eq(clampMessages(m).length, 5, "clampMessages ต้องไม่ตัดข้อความชุดนี้ทิ้ง");
  ok(clampMessages(m)[0].type === "image" && clampMessages(m)[0].originalContentUrl === U(1).originalUrl, "clampMessages ปล่อยข้อความ image ผ่านตามเดิม");
}
{
  const cap = "ประกาศศูนย์ช่วยเหลือประชาชนทางกฎหมาย ".repeat(40).slice(0, MAX_CAPTION);
  const link = normalizeLink("https://example.com/ข่าว/" + "ก".repeat(80)).link;
  const [card] = buildBroadcastMessages({ images: [], caption: cap, link });
  assertFlexSafe(card.contents); checked++;
  const bytes = Buffer.byteLength(JSON.stringify(card.contents), "utf8");
  ok(bytes <= 9500, `การ์ดข้อความยาวสุด ${MAX_CAPTION} ตัว + ลิงก์ยาว ต้องไม่เกิน 9,500 ไบต์ (ได้ ${bytes})`);
  ok(card.altText.length <= 400, "altText ≤ 400");
  const onlyLink = buildBroadcastMessages({ images: [U(1)], caption: "", link: "https://example.com/" });
  eq(onlyLink.length, 2, "มีลิงก์อย่างเดียว (ไม่มีข้อความ) ยังต้องมีการ์ดให้กดปุ่ม");
}

// ─── error ของไลน์ต้องแปลเป็นภาษาคน แยก "โควตาหมด" ออกจาก "ส่งถี่" ───
eq(classifyLineError(429, { message: "You have reached your monthly limit." }).code, "quota", "429 monthly limit = โควตาหมด");
eq(classifyLineError(429, { message: "Too Many Requests" }).code, "rate", "429 อื่น = ส่งถี่เกิน");
{
  const e = classifyLineError(400, { message: "The request body has 1 error(s)", details: [{ message: "invalid uri", property: "messages[1].contents.footer" }] });
  ok(e.code === "invalid" && e.error.includes("messages[1]"), "400 ต้องบอกจุดที่ผิดจาก details ของไลน์");
}
eq(classifyLineError(401, {}).code, "auth", "401 = โทเคนใช้ไม่ได้");
eq(classifyLineError(500, {}).code, "line", "5xx = ไลน์ผิดปกติ");

// ─── วันที่สถิติเพื่อนของไลน์เป็นเวลาญี่ปุ่น (UTC+9) ───
eq(yyyymmddJst(new Date("2026-09-24T14:59:00Z"), 1), "20260923", "23:59 JST วันที่ 24 → เมื่อวาน = 23");
eq(yyyymmddJst(new Date("2026-09-24T15:01:00Z"), 1), "20260924", "00:01 JST วันที่ 25 → เมื่อวาน = 24");

// ─── ⛔ ห้ามกั้นปุ่มส่งด้วยโควตา (หลักที่บอสสั่งไว้กับไลน์สำนักปลัด 23 ก.ย. 69 "ห้ามปิดกั้นการจำกัดโควตา
//        เดี๋ยวผมคำนวณเอง") — จะกลับไปกั้นต้องให้บอสสั่งใหม่เท่านั้น ───
{
  const src = readFileSync(new URL("../api/_broadcast.js", import.meta.url), "utf8");
  ok(!/pushAllowed\s*\(/.test(src), "_broadcast.js ห้ามใช้ pushAllowed() กั้นการส่งประกาศ");
  ok(!/remaining\s*[<>]/.test(src) && !/reachable\s*[<>]/.test(src), "_broadcast.js ห้ามเทียบโควตา/จำนวนผู้รับเพื่อปฏิเสธการส่ง");
  const html = readFileSync(new URL("../public/broadcast.html", import.meta.url), "utf8");
  const line = (html.match(/\$\("sendBtn"\)\.disabled\s*=\s*([^;]+);/) || [])[1] || "";
  ok(line && !/short|left|after|quota|reach/i.test(line), "ปุ่มส่งถึงทุกคนต้องไม่ถูกปิดเพราะโควตา: " + line);
}

console.log(`✅ test-broadcast.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
