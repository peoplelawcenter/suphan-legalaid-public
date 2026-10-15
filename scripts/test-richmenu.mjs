/* scripts/test-richmenu.mjs — ล็อกริชเมนู v2 + ปุ่มทุกปุ่ม "กดแล้วบอทตอบ" แบบออฟไลน์ (ไม่ต้องมีคีย์/ไม่ต่อเน็ต)
   เพิ่ม 30 ก.ย. 69 (งาน T1a ริชเมนู/การ์ดแบบ Traffy — บอสสั่ง "ทุกปุ่มให้กดแล้วตอบข้อความ")
   1) พิกัดปุ่มใน api/_richmenu-layout.js ครอบภาพพอดี ไม่ทับ ไม่เว้น (บทเรียน v1: พิกัดกับภาพไม่ตรงกัน)
   2) ทุกปุ่มเป็น postback ไม่มี uri/ลิงก์ ?k= · ป้าย ≤ 20 ตัว · ป้ายหลักในภาพ ≥ 64px
   3) ทุกรหัส postback (ใหม่ + เดิมที่การ์ดเก่าในแชตยังกดได้) มีคำตอบจาก simplePostbackReply() จริง
   4) ภาพริชเมนู 2500×1686 ≤ 1MB · รูปทุกรูปที่การ์ด/ข้อความอ้างถึง (ไอคอน 3 มิติ/ภาพวิธี/โลโก้) มีไฟล์อยู่จริงใน public/ */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// line-webhook.js import โมดูล DB/LINE — ตั้ง env หลอกไว้ก่อน import (ไม่มีการยิงเน็ตในเทสต์นี้)
process.env.LINE_CHANNEL_SECRET ||= "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-token";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const {
  RICHMENU_AREAS, RICHMENU_SIZE, RICHMENU_IMAGE, RICHMENU_MAX_BYTES, RICHMENU_CHAT_BAR_TEXT, LABEL_PX, MIN_LABEL_PX,
  richMenuDefinition,
} = await import("../api/_richmenu-layout.js");
const { simplePostbackReply } = await import("../api/line-webhook.js");
const { DEFAULTS } = await import("../api/_settings.js");
const { TOPICS } = await import("../api/_keywords.js");
const { clampMessages } = await import("../api/_lineapi.js");
const { HOWTO_IMAGES, WELCOME_HERO } = await import("../api/_serviceinfo.js");
const cards = await import("../api/_cards.js");

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

/* ═══ 1) พิกัด: อยู่ในภาพ · ไม่ทับกัน · พื้นที่รวม = ภาพทั้งภาพ (ไม่ทับ + รวมพอดี = ไม่มีช่องว่าง) ═══ */
const { width: W, height: H } = RICHMENU_SIZE;
ok(W === 2500 && H === 1686, "ริชเมนูต้องเป็น 2500x1686 (large)");
let sum = 0;
for (const a of RICHMENU_AREAS) {
  ok(Number.isInteger(a.x) && Number.isInteger(a.y) && Number.isInteger(a.w) && Number.isInteger(a.h), `${a.key}: พิกัดต้องเป็นจำนวนเต็ม`);
  ok(a.x >= 0 && a.y >= 0 && a.w > 0 && a.h > 0 && a.x + a.w <= W && a.y + a.h <= H, `${a.key}: หลุดขอบภาพ`);
  sum += a.w * a.h;
}
for (let i = 0; i < RICHMENU_AREAS.length; i++) {
  for (let j = i + 1; j < RICHMENU_AREAS.length; j++) {
    const p = RICHMENU_AREAS[i], q = RICHMENU_AREAS[j];
    const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    ok(!overlap, `พื้นที่ปุ่มทับกัน: ${p.key} กับ ${q.key}`);
  }
}
ok(sum === W * H, `พื้นที่ปุ่มรวม ${sum} ไม่เท่าภาพ ${W * H} (มีช่องที่กดแล้วไม่เกิดอะไร)`);
ok(RICHMENU_AREAS.length <= 20, "LINE รับปุ่มได้ไม่เกิน 20 ช่อง");

/* ═══ 2) action: postback ล้วน · ป้าย ≤ 20 · ไม่มี uri/?k= · inputOption ค่าที่ LINE รู้จัก ═══ */
const def = richMenuDefinition();
ok(def.size.width === W && def.size.height === H, "richMenuDefinition: ขนาดไม่ตรงภาพ");
ok(def.chatBarText === RICHMENU_CHAT_BAR_TEXT && def.chatBarText.length <= 14, "chatBarText ต้องไม่เกิน 14 ตัว");
ok(def.areas.length === RICHMENU_AREAS.length, "จำนวนปุ่มใน definition ไม่ตรง layout");
const keys = new Set();
for (const [i, area] of def.areas.entries()) {
  const a = RICHMENU_AREAS[i];
  ok(!keys.has(a.key), `key ซ้ำ: ${a.key}`); keys.add(a.key);
  ok(area.bounds.x === a.x && area.bounds.y === a.y && area.bounds.width === a.w && area.bounds.height === a.h, `${a.key}: bounds ไม่ตรง layout`);
  const act = area.action;
  ok(act.type === "postback", `${a.key}: ต้องเป็น postback (บอสสั่งทุกปุ่มกดแล้วบอทตอบ — ห้าม uri)`);
  ok(typeof act.data === "string" && act.data.startsWith("lg:") && act.data.length <= 300, `${a.key}: data ต้องขึ้นต้น lg:`);
  ok(!/\?k=|https?:/i.test(JSON.stringify(act)), `${a.key}: ห้ามฝังลิงก์/?k= ในริชเมนู`);
  ok(act.label && act.label.length <= 20, `${a.key}: ป้าย a11y "${act.label}" เกิน 20 ตัว`);
  ok(act.displayText && act.displayText.length <= 300, `${a.key}: ต้องมี displayText (ผู้ใช้เห็นฟองข้อความตัวเองตอนกด)`);
  if (act.inputOption) ok(["closeRichMenu", "openRichMenu", "openKeyboard", "openVoice"].includes(act.inputOption), `${a.key}: inputOption ไม่ถูกต้อง`);
  if (act.fillInText) ok(act.fillInText.length <= 300 && act.inputOption === "openKeyboard", `${a.key}: fillInText ใช้คู่ openKeyboard เท่านั้น`);
  ok(Array.isArray(a.lines) && a.lines.length >= 1 && a.lines.every((l) => l && l.trim()), `${a.key}: ต้องมีป้ายในภาพ`);
  ok(fs.existsSync(path.join(PUBLIC_DIR, "assets", "icons3d", a.icon + ".png")), `${a.key}: ไม่มีไฟล์ไอคอน ${a.icon}.png`);
}
for (const [k, px] of Object.entries(LABEL_PX)) ok(px >= MIN_LABEL_PX, `ป้ายหลักแบบ ${k} ${px}px เล็กกว่า ${MIN_LABEL_PX}px (อ่านไม่ออกบนมือถือ)`);
const trackArea = RICHMENU_AREAS.find((a) => a.key === "track");
ok(trackArea && trackArea.inputOption === "openKeyboard", "ปุ่มติดตามเรื่องต้องเปิดคีย์บอร์ดให้พิมพ์เลขเรื่อง");

/* ═══ 3) ทุกรหัส postback มีคำตอบจริง (ใหม่ในริชเมนู v2 + เดิมที่การ์ดเก่า/เมนู v1 ยังกดได้) ═══ */
function assertReplies(data, settings, label = data) {
  const r = simplePostbackReply(data, settings);
  ok(r, `${label}: ไม่มีคำตอบ (ปุ่มกดแล้วเงียบ)`);
  const msgs = clampMessages(r); // clampMessages ตรวจ assertFlexSafe ให้ทุกการ์ดด้วย
  ok(msgs.length >= 1 && msgs.length <= 5, `${label}: จำนวนข้อความ ${msgs.length} (reply ได้ 1–5)`);
  return r;
}
for (const a of RICHMENU_AREAS) assertReplies(a.data, DEFAULTS, `ริชเมนู v2 ${a.key}`);
for (const d of ["lg:consult", "lg:complaint", "lg:knowledge", "lg:faq", "lg:contact", "lg:appointment", "lg:menu"]) assertReplies(d, DEFAULTS, `รหัสเดิม ${d}`);
for (const t of TOPICS) assertReplies(`lg:kw:${t.key}`, DEFAULTS);
assertReplies("lg:kw:ไม่มีหมวดนี้", DEFAULTS, "หมวดที่ไม่รู้จัก (ต้องได้เมนูหลัก ไม่เงียบ)");
ok(simplePostbackReply("lg:consult:open", DEFAULTS) === null, "lg:*:open ต้องไม่ถูกตอบที่นี่ (ต้องออกลิงก์เฉพาะบุคคลใน handlePostback)");
ok(simplePostbackReply("lg:unknown-xyz", DEFAULTS) === null, "รหัสที่ไม่รู้จักต้องคืน null ให้ handlePostback ตอบเมนูหลักเอง");

// สวิตช์จองคิวปิด → การ์ดแจ้งปิดรับ (ไม่ใช่ภาพวิธีจองคิว)
const off = simplePostbackReply("lg:appointment", { ...DEFAULTS, appointment_enabled: false });
ok(!Array.isArray(off) && off.type === "flex" && /ยังไม่เปิดให้บริการ|ปิด/.test(JSON.stringify(off)), "จองคิวตอนปิดสวิตช์ต้องได้การ์ดแจ้งปิดรับ");
const on = simplePostbackReply("lg:appointment", DEFAULTS);
ok(Array.isArray(on) && on[0].type === "image" && on.some((m) => m.type === "location"), "จองคิวตอนเปิด = ภาพวิธี + การ์ด + หมุดแผนที่");
const track = simplePostbackReply("lg:track", DEFAULTS);
ok(track.type === "text" && track.text === cards.TRACK_PROMPT_TEXT, "ติดตามเรื่องต้องตอบข้อความชวนพิมพ์เลขที่เรื่อง (เหมือนพิมพ์ 'ติดตามสถานะ')");

/* ═══ 4) ไฟล์ภาพจริง: ริชเมนู 2500×1686 ≤ 1MB · ภาพวิธีขอรับบริการ ≤ 1MB / preview ≤ 240KB ═══ */
function jpegSize(buf) {
  ok(buf[0] === 0xff && buf[1] === 0xd8, "ไฟล์ภาพต้องเป็น JPEG");
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("อ่านขนาดภาพ JPEG ไม่ได้");
}
const rm = fs.readFileSync(path.join(PUBLIC_DIR, RICHMENU_IMAGE));
ok(rm.length <= RICHMENU_MAX_BYTES, `ภาพริชเมนู ${rm.length} ไบต์ เกินเพดาน LINE 1MB`);
const rmSize = jpegSize(rm);
ok(rmSize.w === W && rmSize.h === H, `ภาพริชเมนู ${rmSize.w}x${rmSize.h} ไม่ตรงพิกัด ${W}x${H}`);
for (const [kind, img] of Object.entries(HOWTO_IMAGES)) {
  const full = fs.statSync(path.join(PUBLIC_DIR, img.full)).size;
  const prev = fs.statSync(path.join(PUBLIC_DIR, img.preview)).size;
  ok(full <= 1024 * 1024, `ภาพวิธี ${kind} ${full} ไบต์ เกิน 1MB`);
  ok(prev <= 240 * 1024, `preview ${kind} ${prev} ไบต์ เกิน 240KB`);
}
ok(fs.existsSync(path.join(PUBLIC_DIR, WELCOME_HERO)), "ไม่มีภาพหัวการ์ดต้อนรับ");
ok(fs.existsSync(path.join(PUBLIC_DIR, "assets", "icons3d", "LICENSE-fluentui-emoji-MIT.txt")), "ต้องมีไฟล์ license MIT ของไอคอน Fluent");

/* ทุก URL รูปที่การ์ด/ข้อความอ้างถึงบนโดเมนเราต้องมีไฟล์จริง (กันพิมพ์ชื่อไอคอนผิด → LINE โชว์กรอบเปล่า) */
const site = process.env.SITE_URL || "https://suphan-legalaid.vercel.app";
const samples = [
  cards.greetingCard("ทดสอบ", DEFAULTS), cards.welcomeMessage("ทดสอบ", DEFAULTS), cards.mainMenuCard(DEFAULTS), cards.helpCard(DEFAULTS),
  cards.aboutCard(DEFAULTS), cards.urgentCard(DEFAULTS), cards.contactCard(DEFAULTS), cards.faqCard("เจ้าหน้าที่"),
  cards.knowledgeCarousel(), cards.chatReceivedCard("เจ้าหน้าที่"), cards.helloCard(), cards.handoffCard(DEFAULTS),
  ...["consult", "complaint", "appointment"].flatMap((k) => cards.serviceReply(k, DEFAULTS)),
  ...TOPICS.map((t) => cards.topicCard(t, "เจ้าหน้าที่")),
  cards.caseConfirmCard({ case_no: "LG-2569-000001", case_type: "consult" }, "เจ้าหน้าที่"),
  cards.statusCard({ case_no: "LG-2569-000001", status: "new", created_at: new Date().toISOString() }),
];
const urls = new Set();
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(walk);
  for (const [k, v] of Object.entries(n)) {
    if (typeof v === "string" && ["url", "originalContentUrl", "previewImageUrl"].includes(k)) urls.add(v);
    else if (v && typeof v === "object") walk(v);
  }
})(samples);
let local = 0;
for (const u of urls) {
  if (!u.startsWith(site + "/")) continue;
  local++;
  const rel = decodeURIComponent(u.slice(site.length + 1).split("?")[0]);
  ok(fs.existsSync(path.join(PUBLIC_DIR, rel)), `การ์ดอ้างรูปที่ไม่มีไฟล์: ${rel}`);
}
ok(local >= 10, `ควรพบรูปบนโดเมนเราอย่างน้อย 10 รูป (พบ ${local})`);

console.log(`✅ test-richmenu.mjs ผ่านทั้งหมด (${checks} ข้อตรวจ · ${RICHMENU_AREAS.length} ปุ่ม · ${local} รูปมีไฟล์จริง)`);
