/* scripts/test-chatgate.mjs — ตรวจตัวตัดสิน "ตอบ/เงียบ" ของข้อความที่ประชาชนพิมพ์ (ออฟไลน์ ไม่แตะ DB/LINE จริง)
   ล็อกพฤติกรรมที่บอสแจ้ง 28 ก.ย. 69 "การ์ดเมนูหลักขึ้นตลอด": การ์ดตอบข้อความคุยเอง/หมวดกฎหมายส่งได้ครั้งเดียว
   ต่อคนต่อ QUIET_WINDOW_MS · ปุ่ม/เลขที่เรื่อง/คำเร่งด่วน/พิมพ์ "เมนู" ต้องตอบทุกครั้ง · คำขอบคุณล้วนไม่ตอบ */
import assert from "node:assert/strict";
import {
  routeText, findCaseNo, isMenuRequest, isCourtesyOnly, needsLoadingIndicator, matchIntent,
  createCardGate, FALLBACK_KIND, QUIET_WINDOW_MS, INTENT_MAX_CHARS, isIntakeContent, STORY_MIN_CHARS, isThanksClosure,
} from "../api/_chatgate.js";
import { TOPICS } from "../api/_keywords.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checked++; }

/* ═══ 1. ลำดับการตัดสินข้อความ ═══ */
eq(routeText("LG-2569-000123").kind, "status", "เลขที่เรื่องล้วนต้องไปดูสถานะ");
eq(routeText("lg-2569-000123").caseNo, "LG-2569-000123", "เลขที่เรื่องตัวพิมพ์เล็กต้องแปลงเป็นตัวใหญ่");
eq(routeText("ขอดูสถานะ LG-2569-000123 ครับ").caseNo, "LG-2569-000123", "เลขที่เรื่องที่ปนในประโยคต้องดึงออกมาได้");
eq(routeText("เรื่องLG-2569-000123ครับ").caseNo, "LG-2569-000123", "เลขที่เรื่องติดภาษาไทยไม่มีช่องว่างต้องดึงได้");
eq(findCaseNo("LG-2569-0001234"), null, "เลขท้าย 7 หลักต้องไม่นับเป็นเลขที่เรื่อง");
eq(routeText("LG2569000123").kind, "caseFormat", "LG ตามด้วยตัวเลขแต่ไม่มีขีด ต้องบอกรูปแบบ ไม่ใช่เงียบ");
eq(routeText("lg 2569").kind, "caseFormat", "เลขที่เรื่องพิมพ์ไม่ครบต้องบอกรูปแบบ");
eq(routeText("#เชื่อม ABC123").kind, "link", "#เชื่อม ต้องไปเชื่อมบัญชี");
eq(routeText("#เชื่อม ABC123").code, "ABC123", "#เชื่อม ต้องส่งรหัสต่อได้ถูก");
eq(routeText("ติดตามสถานะ").kind, "track", "ปุ่มริชเมนูติดตามสถานะ (ส่งเป็นข้อความ) ต้องตอบเสมอ");
for (const t of ["เมนู", "#เมนู", "เมนูหลัก", " เมนู ", "Menu", "# เมนู"]) {
  eq(routeText(t).kind, "menu", `"${t}" ต้องเปิดเมนูหลัก`);
}
ok(!isMenuRequest("เมนูอาหาร"), "คำอื่นที่ขึ้นต้นด้วย เมนู ต้องไม่นับเป็นการขอเมนู");
eq(routeText("ถูกทำร้ายร่างกายครับ").kind, "urgent", "คำเร่งด่วนต้องไปการ์ดฉุกเฉิน");
eq(routeText("ถูกทำร้าย เรื่อง LG-2569-000123").kind, "urgent", "คำเร่งด่วนต้องชนะเลขที่เรื่องที่ปนในประโยค");
for (const t of TOPICS) {
  const sample = t.patterns[0].source.replace(/\\/g, "").replace(/\.\*/g, " ");
  const r = routeText(sample);
  eq(r.kind, "topic", `คำสำคัญหมวด ${t.key} ("${sample}") ต้องไปการ์ดหมวด`);
  eq(r.topic.key, t.key, `คำสำคัญ "${sample}" ต้องได้หมวด ${t.key}`);
}
for (const t of ["ขอบคุณครับ", "ขอบคุณมากค่ะ 🙏", "ขอบคุณมากๆครับ", "ok", "OK ครับ", "โอเคครับ", "รับทราบค่ะ",
  "ได้ครับ", "Thank you", "thx", "ครับ", "ขอบคุณค่ะ!!", "👍🏻 ขอบคุณครับ", "🙏", "👍👍", "❤️"]) {
  eq(routeText(t).kind, "courtesy", `"${t}" เป็นคำสุภาพล้วน ต้องไม่ตอบ`);
}
for (const t of ["ครับ ขอถามหน่อย", "ขอบคุณครับ แล้วต้องเตรียมเอกสารอะไรบ้าง", "ได้ไหมครับ",
  "ที่ดินข้างบ้านรุกล้ำเข้ามาครับ", "ทดสอบ", "?? ที่ดิน"]) {
  eq(routeText(t).kind, "fallback", `"${t}" ต้องไปการ์ด "ได้รับข้อความแล้ว" (ผ่านตัวกั้นซ้ำ)`);
}

/* ═══ 1a. "ขอบคุณ + แจ้งว่าเรื่องจบแล้ว" (บอสแจ้ง 7 ต.ค. 69 — เคยถูกอ่านเป็นส่งเรื่อง) ═══ */
// ต้องเงียบและไม่เข้าร่างรับเรื่อง
for (const t of ["ได้รับการช่วยเหลือแล้ว ขอบคุณมาก", "ได้รับการช่วยเหลือแล้วครับ ขอบคุณมากๆ", "ได้รับการช่วยเหลือแล้วค่ะ ขอบคุณมากค่ะ 🙏",
  "ขอบคุณเจ้าหน้าที่ที่ช่วยเหลือครับ", "ปัญหาแก้ไขเรียบร้อยแล้ว ขอบคุณค่ะ", "เรียบร้อยแล้วค่ะ ขอบคุณมาก", "ขอบคุณทุกท่านที่ช่วยเหลือนะคะ",
  "ขอบคุณที่ช่วยครับ", "ได้รับการช่วยเหลือเรียบร้อยแล้วครับ", "ขอบคุณศูนย์ฯ ที่ดูแลจนเรื่องเสร็จสิ้นแล้วค่ะ", "แก้ไขแล้วครับ ขอบคุณ",
  "ขอบคุณครับ ผมได้รับเงินคืนแล้ว", "ได้รับโทรศัพท์จากเจ้าหน้าที่แล้วค่ะ ขอบคุณ", "ได้รับคำตอบแล้วครับ ขอบคุณมาก"]) {
  eq(routeText(t).kind, "courtesy", `"${t}" คือขอบคุณ/แจ้งว่าจบแล้ว ต้องเงียบ`);
  ok(!isIntakeContent(routeText(t)), `"${t}" ห้ามเข้าร่างรับเรื่อง`);
}
// มีคำปฏิเสธ/คำขอ/คำถาม/เรื่องใหม่ปนแม้คำเดียว ห้ามเงียบ (เงียบผิดเสียหายกว่าถามส่งเรื่องเกิน)
for (const t of ["ขอบคุณครับ แต่ยังไม่ได้รับการช่วยเหลือ", "ยังไม่ได้รับการช่วยเหลือครับ", "ไม่ได้รับการช่วยเหลือเลย", "ได้รับการช่วยเหลือแล้ว แต่ยังมีอีกเรื่อง",
  "ขอบคุณครับ ช่วยเหลือเรื่องที่ดินอีกได้ไหม", "ขอบคุณครับ ขอปรึกษาอีกเรื่อง", "ช่วยเหลือด้วยครับ", "ขอความช่วยเหลือครับ", "ขอบคุณครับ แต่เจ้าหน้าที่ยังไม่โทรกลับ",
  "ขอบคุณครับ ขอเบอร์โทรหน่อย", "ขอบคุณครับ ติดต่อเจ้าหน้าที่ได้ที่ไหน", "ขอคืนเงินครับ", "ยังไม่ได้รับเงินคืนครับ", "ได้รับเงินคืนไหมครับ", "โกงเงินไปครับ ขอบคุณที่ช่วยดู"]) {
  ok(routeText(t).kind !== "courtesy", `"${t}" มีเนื้อหา/คำถาม/ข้อกังวลปนอยู่ ห้ามถูกตีเป็นแค่ขอบคุณ`);
}
ok(!isThanksClosure("ช่วยเหลือครับ"), "คำว่าช่วยเหลือลอยๆ ไม่มีคำขอบคุณ/วลีจบเรื่อง ห้ามถือเป็นขอบคุณ");
ok(!isThanksClosure("ขอบคุณ".repeat(20)), "ข้อความยาวเกินเพดาน ไม่ตีเป็นขอบคุณ");
ok(!needsLoadingIndicator({ type: "message", message: { type: "text", text: "ได้รับการช่วยเหลือแล้ว ขอบคุณมาก" } }), "ขอบคุณ/แจ้งว่าจบแล้ว ห้ามโชว์กำลังพิมพ์ (ไม่ตอบ)");

/* ═══ 1b. พจนานุกรมเจตนา (28 ก.ย. 69 — ไม่ใช้ AI) ═══ */
const INTENT_CASES = {
  greet: ["สวัสดีครับ", "สวัสดีค่ะ 🙏", "หวัดดีครับ", "Hello", "hi"],
  contact: ["ขอเบอร์โทรหน่อยครับ", "เปิดกี่โมงคะ", "ศูนย์อยู่ที่ไหนครับ", "เวลาทำการวันไหนบ้าง", "ขอแผนที่หน่อย"],
  consult: ["อยากปรึกษาเรื่องที่ดินครับ", "ขอคำปรึกษาหน่อยค่ะ", "ขอคำแนะนำเรื่องสัญญาเช่า", "สวัสดีครับ อยากปรึกษาเรื่องที่ดิน"],
  complaint: ["อยากร้องเรียนครับ", "จะแจ้งเรื่องร้องทุกข์", "อยากแจ้งเรื่องเพื่อนบ้านทำเสียงดัง"],
  appointment: ["ขอจองคิวครับ", "อยากพบทนายอาสา", "ขอนัดหมายวันจันทร์"],
  track: ["เรื่องที่ยื่นไว้ถึงไหนแล้วครับ", "ขอติดตามเรื่องหน่อยค่ะ", "มีความคืบหน้าไหมคะ"],
  faq: ["มีค่าใช้จ่ายไหมครับ", "ฟรีไหมคะ", "ต้องเสียเงินไหม", "ใช้งานยังไงครับ"],
  knowledge: ["อยากอ่านความรู้กฎหมาย", "มีบทความกฎหมายไหม"],
  human: ["ขอคุยกับเจ้าหน้าที่หน่อยครับ", "มีคนอยู่ไหมครับ", "ติดต่อเจ้าหน้าที่ยังไง", "ขอคุยกับทนาย"],
};
for (const [kind, list] of Object.entries(INTENT_CASES)) {
  for (const t of list) eq(routeText(t).kind, kind, `"${t}" ต้องได้เจตนา ${kind}`);
}
// ข้อความยาว (เล่าเรื่อง) ห้ามตีเป็นเจตนาจากคำเดียวที่ปนอยู่ — ไปการ์ด "ได้รับข้อความแล้ว"
const story = "ผมติดต่อทนายไปแล้วเมื่อเดือนก่อน เขาบอกว่าเรื่องที่ดินของพ่อต้องไปดูโฉนดที่สำนักงานที่ดินก่อน แต่ตอนนี้พี่น้องยังตกลงกันไม่ได้ว่าจะแบ่งกันอย่างไร อยากทราบว่าควรทำอย่างไรต่อดีครับ";
ok([...story].length > INTENT_MAX_CHARS, "ข้อความตัวอย่างต้องยาวเกินเพดานเจตนาจริง");
eq(routeText(story).kind, "fallback", "เรื่องเล่ายาวที่มีคำว่า ติดต่อ/ที่ดิน ต้องไม่ถูกตีเป็นขอเบอร์");
eq(matchIntent("สวัสดีครับ วันนี้ผมมีเรื่องจะเล่ายาวหน่อยนะครับ"), null, "ทักทายยาวเกิน 30 ตัวที่ไม่มีเจตนาอื่น ไม่นับเป็นแค่ทักทาย");
// ความปลอดภัย/เลขที่เรื่อง/หมวดกฎหมาย ต้องชนะพจนานุกรมเจตนาเสมอ
eq(routeText("ถูกทำร้ายร่างกาย อยากปรึกษาครับ").kind, "urgent", "คำเร่งด่วนต้องชนะเจตนาปรึกษา");
eq(routeText("ติดตามเรื่อง LG-2569-000123").kind, "status", "เลขที่เรื่องในประโยคต้องชนะเจตนาติดตาม");
eq(routeText("โดนโกงเงิน อยากปรึกษาครับ").kind, "topic", "หมวดกฎหมายต้องชนะเจตนาปรึกษา (การ์ดหมวดมีปุ่มฝากเรื่องอยู่แล้ว)");
ok(!isCourtesyOnly(""), "ข้อความว่างต้องไม่นับเป็นคำสุภาพ");
ok(!isCourtesyOnly("   "), "ช่องว่างล้วนต้องไม่นับเป็นคำสุภาพ");
ok(isCourtesyOnly("ขอบพระคุณครับ"), "ขอบพระคุณ ต้องนับเป็นคำสุภาพ");

/* ═══ 2. "กำลังพิมพ์..." เฉพาะ event ที่ตอบแน่และต้องรอ DB ═══ */
const txt = (text) => ({ type: "message", message: { type: "text", text } });
ok(needsLoadingIndicator({ type: "postback", postback: { data: "lg:consult" } }), "กดปุ่ม (postback) ต้องโชว์กำลังพิมพ์");
ok(needsLoadingIndicator(txt("LG-2569-000123")), "ดูสถานะต้องโชว์กำลังพิมพ์ (รอ DB)");
ok(needsLoadingIndicator(txt("#เชื่อม ABC")), "#เชื่อม ต้องโชว์กำลังพิมพ์ (รอ DB)");
ok(!needsLoadingIndicator(txt("สวัสดีครับ")), "ข้อความคุยทั่วไปห้ามโชว์กำลังพิมพ์ (บอทอาจเงียบ)");
ok(!needsLoadingIndicator(txt("มรดก")), "คำสำคัญหมวดห้ามโชว์กำลังพิมพ์ (การ์ดหมวดอาจถูกกั้นซ้ำ)");
ok(!needsLoadingIndicator(txt("ขอบคุณครับ")), "คำขอบคุณห้ามโชว์กำลังพิมพ์ (ไม่ตอบ)");
ok(!needsLoadingIndicator({ type: "message", message: { type: "sticker" } }), "สติกเกอร์ห้ามโชว์กำลังพิมพ์ (ไม่ตอบ)");
ok(!needsLoadingIndicator({ type: "message", message: { type: "image" } }), "รูปห้ามโชว์กำลังพิมพ์ (อาจเงียบ)");
ok(!needsLoadingIndicator({ type: "follow" }), "follow ไม่ต้องโชว์กำลังพิมพ์");

/* ═══ 3. ตัวกั้นการ์ดซ้ำ (DB ปลอม + นาฬิกาปลอม) ═══ */
function fakeStore() {
  const rows = [];
  return {
    rows,
    fail: false,
    async lastSentAt(uid, kind, sinceIso) {
      if (this.fail) throw new Error("DB ล่มจำลอง");
      const since = Date.parse(sinceIso);
      const hit = rows.filter((r) => r.uid === uid && r.kind === kind && r.at >= since).sort((a, b) => b.at - a.at)[0];
      return hit ? hit.at : null;
    },
    async record(uid, kind, rawText) {
      if (this.fail) throw new Error("DB ล่มจำลอง");
      rows.push({ uid, kind, rawText, at: clock });
    },
  };
}
let clock = Date.parse("2026-09-28T02:00:00Z");
const now = () => clock;
const store = fakeStore();
const gate = createCardGate(store, { now });

ok(await gate.claim("U1", FALLBACK_KIND), "ข้อความแรกต้องได้การ์ด");
await gate.confirm("U1", FALLBACK_KIND, null);
eq(store.rows.length, 1, "ส่งการ์ดแล้วต้องบันทึกเวลา 1 แถว");
eq(store.rows[0].rawText, null, "แถว _fallback ห้ามเก็บข้อความที่พิมพ์ (อาจมีรายละเอียดคดีส่วนตัว)");
clock += 60 * 1000;
ok(!(await gate.claim("U1", FALLBACK_KIND)), "ข้อความที่สองใน 1 นาทีต้องเงียบ (หัวใจของบั๊กที่บอสแจ้ง)");
clock += 3 * 60 * 60 * 1000;
ok(!(await gate.claim("U1", FALLBACK_KIND)), "ผ่านไป 3 ชม. ยังต้องเงียบ");
ok(await gate.claim("U2", FALLBACK_KIND), "คนอื่นต้องไม่โดนกั้นเพราะ U1");
ok(await gate.claim("U1", "inheritance"), "การ์ดหมวดกฎหมายต้องกั้นแยกจากการ์ดคุยทั่วไป");

// จำลอง cold start / อีกอินสแตนซ์ — หน่วยความจำว่าง ต้องอ่านจาก DB แล้วยังเงียบ
const gate2 = createCardGate(store, { now });
ok(!(await gate2.claim("U1", FALLBACK_KIND)), "อินสแตนซ์ใหม่ (หน่วยความจำว่าง) ต้องอ่านเวลาจาก DB แล้วเงียบ");

// ครบหน้าต่างเวลาแล้วทักใหม่ได้
clock = store.rows[0].at + QUIET_WINDOW_MS + 1000;
ok(await gate.claim("U1", FALLBACK_KIND), "ครบหน้าต่างเวลาแล้วต้องตอบการ์ดใหม่ได้");
ok(await gate2.claim("U1", FALLBACK_KIND), "ครบหน้าต่างเวลาแล้ว อินสแตนซ์อื่นก็ต้องตอบได้");

// ส่งไม่สำเร็จ → คืนสิทธิ์ ข้อความถัดไปต้องลองตอบใหม่ ไม่เงียบไปทั้งที่ผู้ใช้ไม่เคยเห็นการ์ด
ok(await gate.claim("U3", FALLBACK_KIND), "U3 ข้อความแรกต้องได้การ์ด");
gate.release("U3", FALLBACK_KIND);
ok(await gate.claim("U3", FALLBACK_KIND), "ส่งพลาดแล้วคืนสิทธิ์ ข้อความถัดไปต้องลองส่งใหม่");

// พิมพ์รัวๆ 3 ข้อความพร้อมกัน (LINE ส่งมาหลาย request ติดกัน) — ต้องได้การ์ดใบเดียว
const burst = await Promise.all([gate.claim("U4", FALLBACK_KIND), gate.claim("U4", FALLBACK_KIND), gate.claim("U4", FALLBACK_KIND)]);
eq(burst.filter(Boolean).length, 1, "ข้อความรัวพร้อมกันต้องได้การ์ดใบเดียว");

// DB ล่ม → ตอบไปก่อน (ห้ามเงียบเพราะระบบเราพัง) และ confirm ห้าม throw ทำให้การตอบพัง
// (ปิด console.error ชั่วคราว — error จำลองนี้ตั้งใจให้เกิด ไม่ให้รกผลเทสต์)
const realConsoleError = console.error;
const loggedErrors = [];
console.error = (...a) => loggedErrors.push(a.join(" "));
const badStore = fakeStore();
badStore.fail = true;
const gate3 = createCardGate(badStore, { now });
ok(await gate3.claim("U5", FALLBACK_KIND), "DB ล่มต้องตอบการ์ดไปก่อน ไม่เงียบ");
await gate3.confirm("U5", FALLBACK_KIND, null); // ต้องไม่ throw
ok(!(await gate3.claim("U5", FALLBACK_KIND)), "DB ล่มแต่อินสแตนซ์เดิมยังจำได้ ต้องเงียบข้อความถัดไป");
console.error = realConsoleError;
eq(loggedErrors.length, 2, "DB ล่มต้อง log error ไว้ตามจริง (อ่าน 1 + บันทึก 1) ไม่กลืนเงียบ");

ok(await gate.claim(null, FALLBACK_KIND), "ไม่มี userId ต้องตอบตามปกติ");
ok(await gate.claim(null, FALLBACK_KIND), "ไม่มี userId ต้องตอบทุกครั้ง (ไม่มีตัวตนให้กั้น)");

/* ═══ 4. รับเรื่องทางแชต (2 ต.ค. 69) — เส้นทางใหม่ใน routeText + ล้างตัวกั้นหลังส่งเรื่อง ═══ */
eq(routeText("0812345678", { awaitingPhone: true }).kind, "phone", "ระหว่างรอเบอร์ พิมพ์เบอร์ล้วน = phone");
eq(routeText("เบอร์โทร 081-234-5678 ครับ", { awaitingPhone: true }).kind, "phone", "เบอร์ต้องชนะเจตนา contact เฉพาะตอนรอเบอร์");
eq(routeText("เบอร์โทร 081-234-5678 ครับ").kind, "contact", "ไม่ได้รอเบอร์ = เจตนาขอเบอร์ตามเดิม");
eq(routeText("ข้ามค่ะ", { awaitingPhone: true }).kind, "phoneSkip", "ระหว่างรอเบอร์ พิมพ์ข้าม = phoneSkip");
eq(routeText("ข้ามค่ะ").kind, "fallback", "ไม่ได้รอเบอร์ คำว่าข้ามเป็นข้อความทั่วไป");
eq(routeText("ฉุกเฉิน 0812345678", { awaitingPhone: true }).kind, "urgent", "คำเร่งด่วนชนะเบอร์เสมอ");
eq(routeText("#เมนู", { awaitingPhone: true }).kind, "menu", "เมนูยังทำงานระหว่างรอเบอร์");
eq(routeText("มรดก").story, false, "คำหมวดสั้นไม่ใช่เรื่องเล่า");
ok(routeText("แม่เสียชีวิตแล้วพี่น้องยังแบ่งมรดกที่ดินกันไม่ลงตัวเลยค่ะ").story === true, `คำหมวดในข้อความ ≥ ${STORY_MIN_CHARS} ตัว = เรื่องเล่า`);
for (const t of ["ที่ดินข้างบ้านรุกล้ำเข้ามาครับ", "มรดก", "อยากปรึกษาเรื่องที่ดินครับ", "อยากร้องเรียนครับ", "ขอจองคิวครับ"]) {
  ok(isIntakeContent(routeText(t)), `"${t}" ต้องเข้าร่างรับเรื่อง`);
}
for (const t of ["สวัสดีครับ", "ขอบคุณครับ", "เมนู", "LG-2569-000123", "ขอเบอร์โทรหน่อยครับ", "ฟรีไหมคะ", "มีคนอยู่ไหมครับ", "ถูกทำร้ายร่างกายครับ", "ติดตามสถานะ"]) {
  ok(!isIntakeContent(routeText(t)), `"${t}" ต้องไม่เข้าร่างรับเรื่อง`);
}
ok(!needsLoadingIndicator({ type: "postback", postback: { data: "lg:intake:type" } }), "ปุ่มเปิดคีย์บอร์ด (ไม่ตอบ) ห้ามโชว์กำลังพิมพ์");
// ล้างตัวกั้นหลังส่งเรื่อง: ทั้งหน่วยความจำและ DB — ข้อความถัดไปได้การ์ดรับเรื่องอีกครั้ง
{
  const st = fakeStore();
  st.clear = async function (uid, kind) { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].uid === uid && this.rows[i].kind === kind) this.rows.splice(i, 1); };
  const g = createCardGate(st, { now });
  ok(await g.claim("U9", FALLBACK_KIND), "U9 ได้การ์ดรับเรื่องครั้งแรก");
  await g.confirm("U9", FALLBACK_KIND, null);
  ok(!(await g.claim("U9", FALLBACK_KIND)), "ก่อนส่งเรื่อง ข้อความถัดไปเงียบ");
  await g.reset("U9", FALLBACK_KIND);
  eq(st.rows.filter((r) => r.uid === "U9").length, 0, "reset ลบแถวตัวกั้นใน DB ของคนนี้");
  ok(await g.claim("U9", FALLBACK_KIND), "หลังส่งเรื่อง ข้อความถัดไปได้การ์ดรับเรื่องอีกครั้ง");
  const g2 = createCardGate(st, { now });
  await g2.reset("U9", FALLBACK_KIND);
  ok(await g2.claim("U9", FALLBACK_KIND), "อินสแตนซ์อื่นอ่าน DB แล้วก็ไม่เงียบ");
  // อินสแตนซ์ A จำในหน่วยความจำว่าส่งการ์ดแล้ว → อินสแตนซ์ B ส่งเรื่องสำเร็จแล้ว reset (ล้างได้แค่ DB + Map ของ B)
  // → ข้อความถัดไปที่ไปตก A (เกินช่วงข้อความรัว 2 นาที) ต้องถาม DB แล้วได้การ์ดรับเรื่อง ไม่ใช่เงียบต่อ 12 ชม.
  const A = createCardGate(st, { now });
  const B = createCardGate(st, { now });
  ok(await A.claim("U10", FALLBACK_KIND), "A ส่งการ์ดรับเรื่องให้ U10");
  await A.confirm("U10", FALLBACK_KIND, null);
  clock += 60 * 1000;
  ok(!(await A.claim("U10", FALLBACK_KIND)), "ข้อความรัวใน 2 นาที A เงียบจากหน่วยความจำ");
  await B.reset("U10", FALLBACK_KIND);
  clock += 5 * 60 * 1000;
  ok(await A.claim("U10", FALLBACK_KIND), "หลัง reset จากอินสแตนซ์อื่น A ต้องถาม DB แล้วตอบการ์ดได้ (ไม่เงียบค้าง)");
  await A.confirm("U10", FALLBACK_KIND, null);
  clock += 5 * 60 * 1000;
  ok(!(await A.claim("U10", FALLBACK_KIND)), "ไม่มีการ reset → DB ยังมีแถว ต้องเงียบตามเดิม");
}

console.log(`✅ test-chatgate.mjs ผ่านทั้งหมด (${checked} ข้อ)`);
