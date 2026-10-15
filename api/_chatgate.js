/* api/_chatgate.js — ตัดสินว่าข้อความที่ประชาชนพิมพ์เข้ามา "ควรตอบอะไร/ควรเงียบไหม"

   ⛔ บอสแจ้ง 28 ก.ย. 69: "bot แยกไม่ได้ว่าคนพิมพ์แล้ว card flex เมนูหลักขึ้นตลอดเลย" — เดิมทุกข้อความที่ไม่ตรง
   คำสำคัญ (รวมสติกเกอร์/รูป/คำขอบคุณ) ได้การ์ดเมนูหลักเด้งกลับทุกครั้ง ระหว่างที่ประชาชนคุยกับเจ้าหน้าที่ตัวจริง
   ใน LINE OA Manager (โหมดแชตเปิดอยู่) การ์ดเลยแทรกทุกประโยค และข้อความขึ้นต้นว่า "ขออภัย ยังไม่เข้าใจ" ทั้งที่
   คนพิมพ์เล่าเรื่องจริงมา — LINE ไม่ส่ง webhook ตอนแอดมินพิมพ์ตอบเองในแชต บอทจึงรู้ไม่ได้ว่ามีคนรับช่วงแล้ว
   ทางเดียวที่ทำได้คือ "ตอบครั้งเดียวแล้วเงียบ" ตามหน้าต่างเวลา QUIET_WINDOW_MS ต่อผู้ใช้ต่อการ์ด

   จำเวลาส่งไว้ในตาราง keyword_log เดิม (topic = "_fallback" หรือ key หมวดกฎหมาย) ไม่ต้องรัน migration ใหม่
   ⚠️ แถว "_fallback" ไม่เก็บข้อความที่พิมพ์ (raw_text = null) — ข้อความคุยทั่วไปอาจมีรายละเอียดคดีส่วนตัว
   ⚠️ ถ้าวันหน้าทำสถิติคำค้นจาก keyword_log ต้องกรองแถว topic ที่ขึ้นต้นด้วย "_" ออกก่อน */
import { db } from "./_db.js";
import { matchUrgent, matchTopic } from "./_keywords.js";
import { extractPhone, isPhoneSkip } from "./_chatintake.js";

export const QUIET_WINDOW_MS = 12 * 60 * 60 * 1000; // ข้ามคืนแล้วทักใหม่ได้ ระหว่างวันไม่แทรกบทสนทนา
export const FALLBACK_KIND = "_fallback"; // ขึ้นต้นด้วย _ กันชนกับ key หมวดกฎหมายจริงใน _keywords.js
export const GREET_KIND = "_greet"; // ทักทาย — นับแยกจาก _fallback (ทักแล้วค่อยเล่าเรื่อง = ได้ทั้ง 2 การ์ด ครั้งละใบ)
export const HUMAN_KIND = "_human"; // ขอคุยกับเจ้าหน้าที่ — ถามซ้ำระหว่างรอไม่ได้การ์ดเดิมทุกประโยค
// 2 ต.ค. 69 รับเรื่องทางแชต: บอกผู้ใช้ว่า "ไฟล์นี้ระบบไม่รับ" (วิดีโอ/เสียง/ชนิดอื่น/ใหญ่เกิน) ครั้งเดียวต่อ 12 ชม.
export const FILE_NOTE_KIND = "_filenote";
// ข้อความยาวตั้งแต่นี้ = "เล่าเรื่อง" → การ์ดหมวดกฎหมายหลบให้การ์ดรับเรื่องทางแชต (ข้อความสั้นยังได้การ์ดหมวดเดิม)
export const STORY_MIN_CHARS = 40;
/* route ที่ "มีเนื้อหาเรื่อง" → เก็บเข้าร่างรับเรื่องทางแชต (2 ต.ค. 69 มติบอส "เล่าอิสระ แล้วกดยืนยัน")
   ⛔ เลขเรื่อง/ปุ่ม/เมนู/เร่งด่วน/ทักทาย/ขอบคุณ/ขอเบอร์/faq/ความรู้/ขอคุยกับคน ไม่เข้าร่าง */
const INTAKE_CONTENT_KINDS = new Set(["fallback", "topic", "consult", "complaint", "appointment"]);
export function isIntakeContent(route) {
  return !!route && INTAKE_CONTENT_KINDS.has(route.kind);
}
// postback ที่ตั้งใจไม่ตอบ (ปุ่มเปิดคีย์บอร์ดให้พิมพ์ต่อ — inputOption openKeyboard) ห้ามโชว์ "กำลังพิมพ์..." ค้าง 20 วิ
export const SILENT_POSTBACKS = new Set(["lg:intake:type"]);

const CASE_NO_EXACT_RE = /^LG-\d{4}-\d{6}$/i;
const CASE_NO_ANYWHERE_RE = /\bLG-\d{4}-\d{6}\b/i;
const CASE_NO_ATTEMPT_RE = /^LG[\s-]*\d/i; // ขึ้นต้น LG ตามด้วยตัวเลข แต่รูปแบบไม่ครบ (พิมพ์ตกขีด/ตกหลัก)
const MENU_REQUEST_RE = /^#?\s*(เมนู(หลัก)?|menu)$/i;
// ข้อความสุภาพล้วนๆ (ขอบคุณ/โอเค/รับทราบ + คำลงท้าย) — ต้องประกอบด้วยคำในรายการนี้ทั้งข้อความเท่านั้น
// "ครับ ขอถามหน่อย" ไม่นับ (มีคำอื่นปน) จะไปตกการ์ด "ได้รับข้อความแล้ว" ตามปกติ
const COURTESY_ONLY_RE = /^(ขอบคุณ|ขอบใจ|ขอบพระคุณ|โอเค|ok|okay|รับทราบ|ทราบแล้ว|ได้|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|จ้ะ|นะ|มาก|ๆ|ผม|thank|thanks|you|thx|ty)+$/i;
// ตัดช่องว่าง/เครื่องหมาย/อีโมจิทิ้งก่อนเทียบ — ห้ามตัด \p{M} ทั้งหมด (สระ/วรรณยุกต์ไทยเป็น Mn) ตัดแค่ FE0F
const NOISE_RE = /[\s\p{P}\p{S}\p{Cf}️\p{Extended_Pictographic}]/gu;

export function findCaseNo(text) {
  const t = String(text || "").trim();
  if (CASE_NO_EXACT_RE.test(t)) return t.toUpperCase();
  const m = t.match(CASE_NO_ANYWHERE_RE);
  return m ? m[0].toUpperCase() : null;
}

export function isMenuRequest(text) {
  return MENU_REQUEST_RE.test(String(text || "").trim());
}

// อีโมจิ/เครื่องหมายล้วน (🙏 👍 ...) นับเป็นคำสุภาพด้วย — เทียบเท่าการส่งสติกเกอร์ซึ่งไม่ตอบอยู่แล้ว
export function isCourtesyOnly(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const s = raw.replace(NOISE_RE, "");
  return s.length === 0 || COURTESY_ONLY_RE.test(s);
}

/* 🙏 "ขอบคุณ + แจ้งว่าเรื่องจบแล้ว" (บอสแจ้ง 7 ต.ค. 69: ประชาชนพิมพ์ "ได้รับการช่วยเหลือแล้ว ขอบคุณมาก" บอทอ่านเป็นส่งเรื่อง)
   ต้นเหตุ: isCourtesyOnly ต้องเป็นคำสุภาพล้วนทั้งข้อความ พอมี "ได้รับการช่วยเหลือแล้ว" ปนก็หลุดเป็น fallback → เข้าร่างรับเรื่อง
   วิธีแก้ = บัญชีคำที่อนุญาต "ทั้งข้อความ" (ไม่ใช่การหาคำสำคัญในประโยค) — มีคำอื่นปนแม้คำเดียว (แต่/ยังไม่/ไม่ได้/ที่ดิน/ไหม/ขอ…/คำถามใดๆ)
   ก็ไม่ผ่านและเข้าร่างรับเรื่องตามเดิม · ⛔ เลือกแบบเข้มโดยตั้งใจ: เงียบผิดข้อความร้องเรียนจริงเสียหายกว่าการถามส่งเรื่องเกินจำเป็น
   ⛔ ห้ามเติมคำที่มีความหมายปฏิเสธ/ขอ/ถามเข้ารายการ (ไม่/ยัง/แต่/ขอ/อยาก/ไหม/อะไร ฯลฯ) และต้องเพิ่มเคสใน test-chatgate.mjs ทุกครั้ง
   ต้องมีคำขอบคุณ หรือวลีจบเรื่อง (ได้รับความช่วยเหลือ/แก้ไขแล้ว/เรียบร้อยแล้ว...) อย่างน้อย 1 อย่าง กัน "ช่วยเหลือครับ" ลอยๆ ผ่าน */
const THANKS_TOKENS = ["ขอบคุณ", "ขอบใจ", "ขอบพระคุณ", "ซาบซึ้ง", "ประทับใจ", "thanks", "thank", "thx"];
const CLOSURE_TOKENS = ["ได้รับ", "การ", "ความ", "ช่วยเหลือ", "แก้ไข", "แก้ปัญหา", "ปัญหา", "เรื่อง", "เรียบร้อย", "แล้ว", "เสร็จสิ้น", "เสร็จ",
  "สำเร็จ", "จบ", "ดีแล้ว", "ดีขึ้น", "ราบรื่น", "สมบูรณ์", "ผล", "ดำเนินการ", "ตามที่", "ที่", "จน", "ได้", "ให้", "ช่วย", "ดูแล", "ตอบ",
  "รวดเร็ว", "ใส่ใจ", "ดี", "มาก", "ๆ", "ครับ", "คับ", "ค่ะ", "คะ", "ค่า", "จ้า", "จ้ะ", "นะ", "ผม", "ดิฉัน", "ฉัน", "หนู", "เจ้าหน้าที่",
  "ทีมงาน", "ศูนย์", "ทุกท่าน", "ทุกคน", "ทุก", "ท่าน", "ทนาย", "นิติกร", "โอเค", "ok", "okay", "รับทราบ", "ทราบ",
  // สิ่งที่ผู้แจ้งมักบอกว่า "ได้รับแล้ว" (เงินคืน/สายโทรกลับ/เอกสาร/คำตอบ) — ไม่ใช้คำที่เป็นคำขอหรือเรื่องใหม่
  "เงิน", "คืน", "โทรศัพท์", "โทร", "สาย", "กลับ", "เอกสาร", "คำตอบ", "คำแนะนำ", "ข้อมูล", "จาก"];
const CLOSURE_CUE_RE = /ได้รับ(การ|ความ)?(ช่วยเหลือ|แก้ไข|ดูแล)|แก้ไข(ปัญหา)?(เรียบร้อย)?แล้ว|แก้ปัญหา(เรียบร้อย)?แล้ว|เรียบร้อยแล้ว|เสร็จ(สิ้น)?แล้ว|สำเร็จแล้ว|จบแล้ว/;
const ALL_THANKS_TOKENS = [...THANKS_TOKENS, ...CLOSURE_TOKENS];
const THANKS_MAX_CHARS = 70;

export function isThanksClosure(text) {
  // "ฯ" (ไปยาลน้อย เช่น "ศูนย์ฯ") เป็นตัวอักษรไทย ไม่ใช่เครื่องหมาย NOISE_RE จึงไม่ตัดให้ — ตัดเองตรงนี้
  const s = String(text || "").trim().toLowerCase().replace(NOISE_RE, "").replace(/ฯ/g, "");
  if (!s || s.length > THANKS_MAX_CHARS) return false;
  if (!THANKS_TOKENS.some((t) => s.includes(t)) && !CLOSURE_CUE_RE.test(s)) return false;
  // ตัดทั้งข้อความเป็นคำในบัญชีให้หมดพอดี (DP ตามตำแหน่ง ไม่ใช้ regex วนซ้ำกัน backtrack บานปลาย)
  const ok = new Array(s.length + 1).fill(false);
  ok[s.length] = true;
  for (let i = s.length - 1; i >= 0; i--) {
    ok[i] = ALL_THANKS_TOKENS.some((tok) => s.startsWith(tok, i) && ok[i + tok.length]);
  }
  return ok[0];
}

/* 🧭 พจนานุกรมเจตนา (บอสสั่ง 28 ก.ย. 69 "แยกข้อความได้อย่างฉลาด รู้ว่าคนพิมพ์มาต้องการอะไร")
   ⛔ ศูนย์นี้ตั้งใจไม่ใช้ AI (บอสเลือก: ข้อความประชาชนอาจมีรายละเอียดคดี ห้ามส่งออกไป AI รุ่นฟรี — PDPA)
   ใช้เฉพาะข้อความสั้น ≤ INTENT_MAX_CHARS — ข้อความยาวกว่านั้นคือ "เล่าเรื่อง" คำอย่าง "ติดต่อ" ในเรื่องเล่า
   ("ผมติดต่อทนายไปแล้ว...") ไม่ได้แปลว่าขอเบอร์ จึงไปตกการ์ด "ได้รับข้อความแล้ว" ที่ชี้ไปแบบฟอร์มแทน
   (2 ต.ค. 69: ตกเป็น fallback → เก็บเข้าร่างรับเรื่องทางแชต + การ์ดรับเรื่อง intakeOfferCard แทน chatReceivedCard)
   ลำดับในอาเรย์ = ลำดับชนะ (ขอคุยกับคน/จองคิว/ร้องเรียน/ปรึกษา มาก่อนคำกว้างๆ อย่างเบอร์โทร/ทักทาย) */
export const INTENT_MAX_CHARS = 120;
const INTENTS = [
  { kind: "human", re: /ขอคุยกับ|คุยกับ(เจ้าหน้าที่|คน|แอดมิน|ทนาย|นิติกร)|ติดต่อเจ้าหน้าที่|ขอสายเจ้าหน้าที่|มี(คน|ใคร|เจ้าหน้าที่)อยู่(ไหม|มั้ย|หรือเปล่า)|แอดมิน|admin/i },
  { kind: "appointment", re: /จองคิว|ขอนัด|นัดหมาย|นัดพบ|พบทนาย|ทนายอาสา|ขอพบเจ้าหน้าที่/ },
  { kind: "complaint", re: /ร้องเรียน|ร้องทุกข์|แจ้งเรื่อง|อยากแจ้ง/ },
  { kind: "consult", re: /ปรึกษา|ขอคำแนะนำ|สอบถามข้อกฎหมาย|อยากถามเรื่องกฎหมาย|ถามเรื่องกฎหมาย/ },
  { kind: "track", re: /ติดตามเรื่อง|ติดตามสถานะ|สถานะเรื่อง|เรื่อง.{0,20}ถึงไหน|คืบหน้า/ },
  { kind: "contact", re: /เบอร์|โทรศัพท์|ติดต่อได้|ติดต่อที่|เวลาทำการ|เปิดกี่โมง|ปิดกี่โมง|เปิดวันไหน|เปิดทำการ|ที่อยู่|อยู่ที่ไหน|อยู่ตรงไหน|ที่ตั้ง|แผนที่|ไปยังไง|เดินทาง/ },
  { kind: "faq", re: /ค่าใช้จ่าย|เสียเงิน|เสียค่า|มีค่าบริการ|ฟรี(ไหม|มั้ย|หรือเปล่า)|ปลอดภัย(ไหม|มั้ย)|ใครเป็นคนตอบ|ใช้(งาน)?ยังไง|ใช้(งาน)?อย่างไร/ },
  { kind: "knowledge", re: /ความรู้กฎหมาย|ความรู้ทางกฎหมาย|บทความกฎหมาย|อยากรู้เรื่องกฎหมาย/ },
];
const GREET_RE = /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ดีคะ|hello|hi\b|hey\b)/i;
const GREET_MAX_CHARS = 30;

export function matchIntent(text) {
  const t = String(text || "").trim();
  if (!t || [...t].length > INTENT_MAX_CHARS) return null;
  const hit = INTENTS.find((i) => i.re.test(t));
  if (hit) return hit.kind;
  if ([...t].length <= GREET_MAX_CHARS && GREET_RE.test(t)) return "greet";
  return null;
}

/* ลำดับสำคัญ: เลขที่เรื่องล้วน → #เชื่อม → ปุ่มติดตามสถานะ → ขอเมนู → คำเร่งด่วน (ชนะเลขเรื่องที่ปนในประโยค
   เพราะความปลอดภัยมาก่อน) → เลขเรื่องในประโยค → [ระหว่างรอเบอร์: มีเบอร์ = phone · "ไม่มีเบอร์/ข้าม" = phoneSkip] →
   หมวดกฎหมาย (การ์ดหมวดมีปุ่มฝากเรื่องอยู่แล้ว) → เลขเรื่องพิมพ์ผิดรูปแบบ → เจตนาจากพจนานุกรม → คำสุภาพ → ที่เหลือ
   2 ต.ค. 69: ctx.awaitingPhone (ร่างรับเรื่องทางแชตกำลังรอเบอร์) — ต้องตรวจเบอร์ก่อนพจนานุกรมเจตนา เพราะ "เบอร์ 08…"
   ชนเจตนา contact · topic มี story=true ถ้ายาว ≥ STORY_MIN_CHARS (เล่าเรื่อง → การ์ดรับเรื่องแทนการ์ดหมวด) */
export function routeText(text, ctx = {}) {
  const t = String(text || "").trim();
  if (CASE_NO_EXACT_RE.test(t)) return { kind: "status", caseNo: t.toUpperCase() };
  if (t.startsWith("#เชื่อม ")) return { kind: "link", code: t.slice("#เชื่อม ".length).trim() };
  if (t === "ติดตามสถานะ") return { kind: "track" };
  if (isMenuRequest(t)) return { kind: "menu" };
  if (matchUrgent(t)) return { kind: "urgent" };
  const caseNo = findCaseNo(t);
  if (caseNo) return { kind: "status", caseNo };
  if (ctx.awaitingPhone) {
    const phone = extractPhone(t);
    if (phone) return { kind: "phone", phone };
    if (isPhoneSkip(t)) return { kind: "phoneSkip" };
  }
  // ขอบคุณ/แจ้งว่าจบเรื่องแล้ว — ตรวจก่อนหมวดกฎหมาย/เจตนา (บัญชีคำทั้งข้อความ ไม่มีคำหมวด/คำขอ/ปฏิเสธปนได้ จึงไม่บังการ์ดที่ควรตอบ)
  if (isThanksClosure(t)) return { kind: "courtesy" };
  const topic = matchTopic(t);
  if (topic) return { kind: "topic", topic, story: [...t].length >= STORY_MIN_CHARS };
  if (CASE_NO_ATTEMPT_RE.test(t)) return { kind: "caseFormat" };
  const intent = matchIntent(t);
  if (intent) return { kind: intent };
  if (isCourtesyOnly(t)) return { kind: "courtesy" };
  return { kind: "fallback" };
}

/* "กำลังพิมพ์..." (showLoading 20 วิ) เฉพาะ event ที่ตอบแน่นอนและต้องรอ DB — ห้ามโชว์กับข้อความคุยทั่วไป/สติกเกอร์
   เพราะอาจเงียบตามหน้าต่างเวลา ผู้ใช้จะเห็นจุดสามจุดค้าง 20 วิแล้วไม่มีอะไรตอบ (ดูเหมือนบอทค้าง) */
export function needsLoadingIndicator(event) {
  if (event?.type === "postback") return !SILENT_POSTBACKS.has(event.postback?.data || "");
  if (event?.type !== "message" || event.message?.type !== "text") return false;
  const { kind } = routeText(event.message.text);
  return kind === "status" || kind === "link";
}

/* ตัวกั้นการ์ดซ้ำ — store ต้องมี lastSentAt(uid, kind, sinceIso) → ms|null และ record(uid, kind, rawText)
   แยก store ออกมาให้ scripts/test-chatgate.mjs ทดสอบออฟไลน์ได้ (ของจริงใช้ keywordLogStore ด้านล่าง)
   Map ในหน่วยความจำ = ด่านแรกกันข้อความที่พิมพ์รัวๆ (LINE ส่งมาหลาย event/หลาย request ติดกัน) ส่วน DB
   = ด่านที่สองข้ามอินสแตนซ์/หลัง cold start */
/* 2 ต.ค. 69: Map ตัดสินเองได้เฉพาะช่วงสั้น burstMs (ข้อความรัว) — เกินนั้นถาม DB เสมอ เพราะ reset() (ส่งเรื่องทางแชตสำเร็จ)
   ล้าง Map ได้แค่อินสแตนซ์ตัวเอง อินสแตนซ์อื่นที่ยังจำไว้ต้องไม่เงียบต่อ 12 ชม. ทั้งที่ DB ล้างแล้ว */
export const GATE_BURST_MS = 2 * 60 * 1000;
export function createCardGate(store, { windowMs = QUIET_WINDOW_MS, burstMs = GATE_BURST_MS, now = () => Date.now() } = {}) {
  const recent = new Map(); // `${uid}|${kind}` → เวลาที่ส่งการ์ดล่าสุด (ms)
  const keyOf = (uid, kind) => uid + "|" + kind;
  return {
    async claim(uid, kind) {
      if (!uid) return true; // ไม่รู้ว่าใคร — ตอบตามปกติ
      const t = now();
      for (const [k, at] of recent) if (t - at >= windowMs) recent.delete(k);
      const key = keyOf(uid, kind);
      if (recent.has(key) && t - recent.get(key) < Math.min(burstMs, windowMs)) return false;
      recent.set(key, t); // จองก่อน await ใดๆ — สอง request พร้อมกันในอินสแตนซ์เดียวจะผ่านได้แค่ตัวเดียว
      try {
        const last = await store.lastSentAt(uid, kind, new Date(t - windowMs).toISOString());
        if (last != null && t - last < windowMs) {
          recent.set(key, last);
          return false;
        }
      } catch (e) {
        // อ่านประวัติไม่ได้ (DB ล่ม) → ตอบไปก่อน ห้ามเงียบเพราะระบบเราเอง (SPEC.md ข้อ 7)
        console.error("cardGate: อ่านเวลาส่งการ์ดล่าสุดไม่ได้ ตอบไปก่อน", e);
      }
      return true;
    },
    async confirm(uid, kind, rawText = null) {
      if (!uid) return;
      try {
        await store.record(uid, kind, rawText);
      } catch (e) {
        console.error("cardGate: บันทึกเวลาส่งการ์ดไม่ได้", e);
      }
    },
    // ส่งการ์ดไม่สำเร็จ → คืนสิทธิ์ ข้อความถัดไปได้ลองตอบใหม่ ไม่เงียบไป 12 ชม. ทั้งที่ยังไม่เคยเห็นการ์ด
    release(uid, kind) {
      if (uid) recent.delete(keyOf(uid, kind));
    },
    // 2 ต.ค. 69: ส่งเรื่องทางแชตสำเร็จ/ยกเลิกร่าง → ล้างตัวกั้นของคนนี้ (หน่วยความจำ + DB) ข้อความถัดไปได้การ์ดรับเรื่องอีกครั้ง
    // (ซึ่งจะมีปุ่ม "เพิ่มข้อมูลเข้าเรื่องเดิม") · ล้าง DB ไม่ได้ = log ไว้ ไม่ทำให้งานหลักล้ม
    async reset(uid, kind) {
      if (!uid) return;
      recent.delete(keyOf(uid, kind));
      try {
        if (store.clear) await store.clear(uid, kind);
      } catch (e) {
        console.error("cardGate: ล้างเวลาส่งการ์ดไม่ได้", e);
      }
    },
  };
}

export const keywordLogStore = {
  async lastSentAt(uid, kind, sinceIso) {
    const { data, error } = await db().from("keyword_log").select("created_at")
      .eq("line_uid", uid).eq("topic", kind).gte("created_at", sinceIso)
      .order("created_at", { ascending: false }).limit(1);
    if (error) throw error;
    return data && data.length ? new Date(data[0].created_at).getTime() : null;
  },
  async record(uid, kind, rawText) {
    const { error } = await db().from("keyword_log").insert({ topic: kind, raw_text: rawText, line_uid: uid });
    if (error) throw error;
  },
  // ลบเฉพาะแถวตัวกั้นของคนนี้ (topic ขึ้นต้นด้วย _ เป็นแถวจดเวลาล้วน raw_text=null ไม่ใช่สถิติคำค้น)
  async clear(uid, kind) {
    const { error } = await db().from("keyword_log").delete().eq("line_uid", uid).eq("topic", kind);
    if (error) throw error;
  },
};
