/* scripts/test-avatar.mjs — ตัวตรวจรูปโปรไฟล์เจ้าหน้าที่ (api/_avatar.js · ใหม่ 7 ต.ค. 69 · migration-16)
   ตรวจออฟไลน์ล้วน ไม่แตะ DB: รับเฉพาะ JPEG จริง ≤ 80 KB ขนาด 64–512 px · ปฏิเสธทุกอย่างที่ลอดเข้า CSS url() ได้ · เก็บค่าที่เข้ารหัสใหม่เท่านั้น
   ⛔ ฟิกซ์เจอร์ FIXTURE_256 สร้างจากตัวเข้ารหัส JPEG จริง (Pillow) ไม่ใช่ไบต์ที่ประกอบเอง — กันเทสต์ผ่านเพราะเข้าข้างตัวเอง */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AVATAR_PREFIX, AVATAR_MAX_BYTES, jpegDimensions, parseAvatarDataUrl, safeAvatarForClient,
} from "../api/_avatar.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

// JPEG 256×256 จริง (Pillow, quality 85) เป็น base64
const FIXTURE_256 = "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";

// ประกอบ JPEG "โครงล้วน" ที่มี SOF บอกขนาด (ไม่ต้องถอดภาพได้ — ตัวตรวจอ่านแค่ marker) ไว้ทดสอบขอบเขตขนาด/ความยาว
function fakeJpeg(w, h, padBytes = 0) {
  const be = (n) => [(n >> 8) & 0xff, n & 0xff];
  const parts = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],       // APP0 (JFIF)
    [0xff, 0xc0, 0x00, 0x11, 0x08, ...be(h), ...be(w), 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],        // SOF0
    [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00],                               // SOS
    new Array(padBytes).fill(0x55),
    [0xff, 0xd9],
  ];
  return Buffer.from(parts.flat());
}
const asUrl = (buf) => AVATAR_PREFIX + buf.toString("base64");

// ── ฟิกซ์เจอร์จริง: ผ่าน และเก็บค่าเดิมเป๊ะ ──
{
  const real = Buffer.from(FIXTURE_256, "base64");
  const dim = jpegDimensions(real);
  ok(dim && dim.width === 256 && dim.height === 256, "อ่านขนาด JPEG จริงจาก SOF ได้ 256×256");
  const r = parseAvatarDataUrl(AVATAR_PREFIX + FIXTURE_256);
  ok(r.ok && r.width === 256 && r.height === 256 && r.bytes === real.length, "JPEG 256×256 จริงต้องผ่าน");
  ok(r.dataUrl === AVATAR_PREFIX + FIXTURE_256, "ค่าที่เก็บต้องเป็นรูปแบบเข้ารหัสมาตรฐานเดียวกับต้นฉบับ");
  ok(safeAvatarForClient(r.dataUrl) === r.dataUrl, "ค่าที่ผ่านตัวตรวจแล้วต้องส่งให้หน้าเว็บได้");
}

// ── ไฟล์จริงในโปรเจกต์ (hero-cover.jpg = 1207×413 ตามที่ Pillow อ่านได้) ──
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const hero = fs.readFileSync(path.join(here, "..", "public", "assets", "hero-cover.jpg"));
  const dim = jpegDimensions(hero);
  ok(dim && dim.width === 1207 && dim.height === 413, "อ่านขนาด JPEG จริงของโปรเจกต์ได้ตรงกับตัวเข้ารหัสอ้างอิง (1207×413)");
}

// ── ปฏิเสธ: ชนิด/รูปแบบผิด ──
{
  for (const bad of [undefined, null, 123, {}, "", "hello", "data:image/png;base64,AAAA", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:text/html;base64,PGI+", "javascript:alert(1)", "https://x.y/a.jpg"]) {
    ok(!parseAvatarDataUrl(bad).ok, `ต้องปฏิเสธ: ${String(bad).slice(0, 30)}`);
  }
  ok(!parseAvatarDataUrl(AVATAR_PREFIX).ok, "ไม่มีข้อมูลหลัง prefix ต้องปฏิเสธ");
  // อักขระที่หลุดออกจาก CSS url("...") ได้ — ต้องไม่ผ่านแม้ส่วนที่เหลือเป็น JPEG จริง
  for (const inj of ['"', ")", "'", " ", "\n", ";", "\\", "<", ">", "%", "(", "}"]) {
    ok(!parseAvatarDataUrl(AVATAR_PREFIX + FIXTURE_256.slice(0, 40) + inj + FIXTURE_256.slice(40)).ok, `ต้องปฏิเสธอักขระ ${JSON.stringify(inj)} ใน base64`);
  }
  ok(!parseAvatarDataUrl(AVATAR_PREFIX + FIXTURE_256 + "=== ").ok, "ท้ายสตริงมีช่องว่าง/เครื่องหมายเกินต้องปฏิเสธ");
  ok(safeAvatarForClient(`${AVATAR_PREFIX}AAAA")}body{display:none`) === null, "ค่าจากฐานที่มีอักขระแปลกต้องไม่ถูกส่งให้หน้าเว็บ");
  ok(safeAvatarForClient(null) === null && safeAvatarForClient(42) === null && safeAvatarForClient("") === null, "ค่าว่าง/ไม่ใช่สตริงต้องได้ null");
}

// ── ปฏิเสธ: ไม่ใช่ JPEG จริง ──
{
  ok(!parseAvatarDataUrl(asUrl(Buffer.from("this is not a jpeg at all"))).ok, "ข้อความธรรมดาที่แปะป้าย jpeg ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).ok, "PNG ที่แปะป้าย jpeg ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).ok, "JPEG ที่ไม่มี SOF (ไม่มีขนาดภาพ) ต้องปฏิเสธ");
  const truncated = fakeJpeg(256, 256).subarray(0, 25);
  ok(!parseAvatarDataUrl(asUrl(truncated)).ok, "JPEG ที่ถูกตัดกลาง SOF ต้องปฏิเสธ (ไม่ crash)");
  ok(jpegDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])) === null, "segment ความยาวผิดปกติต้องคืน null ไม่วนไม่รู้จบ");
  ok(jpegDimensions(Buffer.alloc(0)) === null && jpegDimensions(null) === null, "บัฟเฟอร์ว่าง/null ต้องคืน null");
}

// ── ขอบเขตขนาดภาพ 64–512 ──
{
  ok(parseAvatarDataUrl(asUrl(fakeJpeg(64, 64))).ok, "64×64 ผ่าน (ขอบล่าง)");
  ok(parseAvatarDataUrl(asUrl(fakeJpeg(512, 512))).ok, "512×512 ผ่าน (ขอบบน)");
  ok(parseAvatarDataUrl(asUrl(fakeJpeg(300, 200))).ok, "ภาพไม่จัตุรัสในช่วงที่อนุญาตผ่าน (หน้าเว็บครอปด้วย CSS cover)");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(63, 256))).ok, "กว้าง 63 ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(256, 63))).ok, "สูง 63 ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(513, 256))).ok, "กว้าง 513 ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(256, 4000))).ok, "สูง 4000 ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(0, 0))).ok, "0×0 ต้องปฏิเสธ");
}

// ── ขอบเขตขนาดไฟล์ ≤ 80 KB ──
{
  const overhead = fakeJpeg(256, 256).length;
  ok(parseAvatarDataUrl(asUrl(fakeJpeg(256, 256, AVATAR_MAX_BYTES - overhead))).ok, "ขนาดพอดีเพดาน 80 KB ต้องผ่าน");
  ok(!parseAvatarDataUrl(asUrl(fakeJpeg(256, 256, AVATAR_MAX_BYTES - overhead + 1))).ok, "เกินเพดาน 1 ไบต์ต้องปฏิเสธ");
  ok(!parseAvatarDataUrl(AVATAR_PREFIX + "A".repeat(2_000_000)).ok, "สตริงใหญ่ผิดปกติต้องถูกตัดตั้งแต่ก่อนถอดรหัส");
}

// ── base64 ไม่ครบ padding ยังถอดได้ แต่ค่าที่เก็บต้องถูกเข้ารหัสใหม่ให้ถูกต้อง ──
{
  const buf = fakeJpeg(256, 256, 1);   // ความยาวไม่หาร 3 ลงตัว → มี padding
  const url = asUrl(buf);
  const noPad = url.replace(/=+$/, "");
  const r = parseAvatarDataUrl(noPad);
  ok(r.ok && r.dataUrl === url, "base64 ขาด padding ต้องถูกเก็บเป็นรูปแบบมาตรฐานที่มี padding");
}

console.log(`✅ test-avatar.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
