/* scripts/validate-live.mjs — ให้ LINE ตรวจรูปแบบ "ของจริง" ทุกข้อความ/การ์ด + ริชเมนู v2 โดยไม่ส่งถึงใคร (30 ก.ย. 69)
   ใช้ endpoint ตรวจอย่างเดียวของ LINE:
     POST /v2/bot/message/validate/reply   (ข้อความชุดละ ≤ 5 — ชุดเดียวกับที่ reply จริง)
     POST /v2/bot/richmenu/validate        (object ริชเมนูที่ richmenu-setup.js จะสร้าง)
   ⛔ ไม่มีการ push/reply/broadcast จริง (กฎข้อ 5 ใน CLAUDE.md) — ต่างจาก assertFlexSafe/test-cards.mjs ที่ตรวจตามที่เราเข้าใจสเปก
      ตัวนี้ถามตัว LINE เองว่ารับไหม (จับเคสที่เราเข้าใจสเปกผิดได้)
   รัน: ตั้ง env LINE_CHANNEL_ACCESS_TOKEN แล้ว npm run validate-live */
import { clampMessages } from "../api/_lineapi.js";
import { DEFAULTS } from "../api/_settings.js";
import { TOPICS } from "../api/_keywords.js";
import { richMenuDefinition } from "../api/_richmenu-layout.js";
import * as C from "../api/_cards.js";

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) {
  console.error("ต้องตั้ง env LINE_CHANNEL_ACCESS_TOKEN ก่อน (ค่าอยู่ใน _private/line-credentials.txt — ห้าม commit)");
  process.exit(2);
}
const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
const S = DEFAULTS;
const longLabel = { ...S, responder_label: "นิติกรหรือทนายความอาสาของสภาทนายความจังหวัดสุพรรณบุรี" };

const sets = {
  "ต้อนรับ (follow)": [C.welcomeMessage("สมชาย ใจดี", S), C.welcomePosterMessage(), C.greetingCard("สมชาย ใจดี", S)],
  "ต้อนรับ (ไม่มีชื่อ)": [C.welcomeMessage(null, S), C.welcomePosterMessage(), C.greetingCard(null, { ...S, appointment_enabled: false })],
  "ปรึกษา": C.serviceReply("consult", S),
  "จองคิว": C.serviceReply("appointment", S),
  "ร้องเรียน": C.serviceReply("complaint", S),
  "หลักเกณฑ์ (ป้ายผู้ตอบยาว)": ["consult", "appointment", "complaint"].map((k) => C.serviceGuideCard(k, longLabel)),
  "เมนูหลัก": C.mainMenuCard(S),
  "ขอความช่วยเหลือ": C.helpCard(S),
  "เกี่ยวกับศูนย์": C.aboutCard(S),
  "เหตุด่วน": C.urgentCard(S),
  "ติดต่อเรา": C.contactCard(S),
  "คำถามที่พบบ่อย": C.faqCard(S.responder_label),
  "ความรู้กฎหมาย": C.knowledgeCarousel(),
  "หมวดกฎหมาย (5)": TOPICS.slice(0, 5).map((t) => C.topicCard(t, S.responder_label)),
  "ได้รับข้อความ/ทักทาย/ติดต่อเจ้าหน้าที่": [C.chatReceivedCard(S.responder_label), C.helloCard(), C.handoffCard(S)],
  "ติดตามเรื่อง": { type: "text", text: C.TRACK_PROMPT_TEXT },
  "ยืนยันรับเรื่องจองคิว (เวลา HH:MM)": C.caseConfirmCard({ case_no: "LG-2569-000123", case_type: "appointment", preferred_date: "2026-10-01", preferred_time: "13:00", preferred_time_slot: "afternoon" }, S.responder_label),
  "จองคิวปิดรับ": C.appointmentUnavailableCard(S.responder_label),
  // 2 ต.ค. 69 รับเรื่องทางแชต — การ์ดใหม่ทุกใบ (ปุ่มเปิดคีย์บอร์ด inputOption openKeyboard ไม่มี displayText ต้องผ่านไลน์จริงด้วย)
  "รับเรื่องทางแชต: การ์ดรับเรื่อง/ขอเบอร์/วิธีแจ้ง": [
    C.intakeOfferCard({ texts: 3, files: 2, locations: 1, preview: "เพื่อนบ้านสร้างรั้วรุกล้ำเข้ามาในที่ดิน…" }, longLabel, { openCaseNo: "LG-2569-000123" }),
    C.intakePhoneCard(longLabel, { reminder: true, type: "appointment" }),
    C.intakeHowtoCard(S, null),
    C.intakeHowtoCard(S, { texts: 1, files: 0, locations: 0, preview: "ทดสอบ" }, { openCaseNo: "LG-2569-000123" }),
    C.intakeEmptyCard(S),
  ],
  "รับเรื่องทางแชต: ผลการส่ง": [
    C.caseConfirmCard({ case_no: "LG-2569-000124", case_type: "appointment", source: "chat", citizen_phone: null, detail: "x" }, S.responder_label),
    C.intakeAppendedCard("LG-2569-000124", { texts: 2, files: 1, dropped: 1 }, S),
    C.intakeAlreadySentCard("LG-2569-000124"),
    C.intakeEmptyCard(S, { forAppend: true }),
    C.intakeFileNoticeText("type"),
  ],
};

let fail = 0;
for (const [name, msgs] of Object.entries(sets)) {
  const messages = clampMessages(msgs);
  const res = await fetch("https://api.line.me/v2/bot/message/validate/reply", { method: "POST", headers: H, body: JSON.stringify({ messages }) });
  const body = await res.text();
  if (res.ok) console.log(`✅ ${name} (${messages.length} ข้อความ)`);
  else { fail++; console.error(`❌ ${name} — HTTP ${res.status} ${body}`); }
}

const rm = await fetch("https://api.line.me/v2/bot/richmenu/validate", { method: "POST", headers: H, body: JSON.stringify(richMenuDefinition()) });
if (rm.ok) console.log("✅ ริชเมนู v2 (object ที่จะสร้าง)");
else { fail++; console.error(`❌ ริชเมนู v2 — HTTP ${rm.status} ${await rm.text()}`); }

if (fail) { console.error(`\n❌ LINE ปฏิเสธ ${fail} ชุด`); process.exit(1); }
console.log("\n✅ LINE รับรูปแบบทุกชุด (ตรวจอย่างเดียว ไม่ได้ส่งถึงใคร)");
