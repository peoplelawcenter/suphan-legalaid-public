/* scripts/test-cards.mjs — ตรวจการ์ด Flex ทุกใบแบบออฟไลน์ (ไม่ต้องมีคีย์/ไม่ต่อเน็ต)
   ล็อกลิมิตของ LINE ไว้ตั้งแต่ก่อน deploy: bubble ≤9,500 ไบต์ · altText ≤400 · ป้ายปุ่ม ≤40
   ห้ามมีฟิลด์ผิดคอมโพเนนต์ (cornerRadius บน image ฯลฯ) · ห้าม text ว่าง/undefined */
import assert from "node:assert/strict";
import {
  greetingCard, welcomeMessage, cleanDisplayName, mainMenuCard, helpCard, aboutCard, chatReceivedCard, helloCard, handoffCard,
  serviceReply, serviceGuideCard, howtoImageMessage, officeLocationMessage, formLinkCard, topicCard, knowledgeCarousel,
  faqCard, contactCard, urgentCard, caseConfirmCard, statusCard, statusNotFoundCard, errorCard,
  appointmentUnavailableCard, satisfactionRequestCard, cancelConfirmCard, broadcastCaptionCard,
  intakeOfferCard, intakeEmptyCard, intakePhoneCard, intakeHowtoCard, intakeAppendedCard, intakeAlreadySentCard, intakeFileNoticeText,
  INTAKE_BUSY_TEXT, INTAKE_CANCELLED_TEXT, INTAKE_APPT_OFF_TEXT,
} from "../api/_cards.js";
import { HOTLINES } from "../api/_serviceinfo.js";
import { TOPICS } from "../api/_keywords.js";
import { clampMessages, assertFlexSafe, FLEX_BTN_LABEL_MAX } from "../api/_lineapi.js";
import { DEFAULTS } from "../api/_settings.js";

let checked = 0;
function checkCard(name, card) {
  checked++;
  assert.ok(card, `${name}: การ์ดเป็น null/undefined`);
  const clamped = clampMessages(card);
  for (const msg of clamped) {
    if (msg.type === "flex") {
      assertFlexSafe(msg.contents); // throw ถ้าฟิลด์ผิดคอมโพเนนต์
      assert.ok(msg.altText && msg.altText.length <= 400, `${name}: altText เกิน 400 ตัวหรือว่าง`);
      const bytes = Buffer.byteLength(JSON.stringify(msg.contents), "utf8");
      assert.ok(bytes <= 9500, `${name}: bubble ${bytes} ไบต์ เกิน 9,500 (contents: ${JSON.stringify(msg).slice(0, 120)}...)`);
      checkButtonLabels(name, msg.contents);
    }
    if (msg.type === "text") {
      assert.ok(msg.text && msg.text !== "undefined", `${name}: text ว่างหรือ "undefined"`);
      assert.ok(msg.text.length <= 5000, `${name}: text เกิน 5,000 ตัว (เพดาน LINE)`);
    }
    // 30 ก.ย. 69: ภาพวิธีขอรับบริการ (image message) — https ASCII ล้วนทั้งคู่ (สเปก LINE)
    if (msg.type === "image") {
      for (const f of ["originalContentUrl", "previewImageUrl"]) {
        assert.ok(/^https:\/\/[\x21-\x7E]+$/.test(msg[f] || ""), `${name}: ${f} ต้องเป็น https ASCII ล้วน — "${msg[f]}"`);
      }
    }
    // 30 ก.ย. 69: หมุดแผนที่ (location message) — title/address ≤ 100 ตัว · พิกัดเป็นตัวเลขในช่วงที่ถูกต้อง
    if (msg.type === "location") {
      assert.ok(msg.title && msg.title.length <= 100, `${name}: location title ว่างหรือเกิน 100 ตัว`);
      assert.ok(msg.address && msg.address.length <= 100, `${name}: location address ว่างหรือเกิน 100 ตัว`);
      assert.ok(typeof msg.latitude === "number" && Math.abs(msg.latitude) <= 90, `${name}: latitude ไม่ถูกต้อง`);
      assert.ok(typeof msg.longitude === "number" && Math.abs(msg.longitude) <= 180, `${name}: longitude ไม่ถูกต้อง`);
    }
  }
}

function checkButtonLabels(name, node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => checkButtonLabels(name, n));
  if (node.type === "button" && node.action?.label) {
    assert.ok(node.action.label.length <= FLEX_BTN_LABEL_MAX, `${name}: ป้ายปุ่ม "${node.action.label}" เกิน ${FLEX_BTN_LABEL_MAX} ตัว`);
  }
  for (const v of Object.values(node)) if (v && typeof v === "object") checkButtonLabels(name, v);
}

checkCard("greetingCard", greetingCard());
checkCard("greetingCard(name)", greetingCard("ทดสอบชื่อยาวสามสิบตัวอักษรxxxxx"));
checkCard("greetingCard(settings appt off)", greetingCard(null, { ...DEFAULTS, appointment_enabled: false }));
checkCard("mainMenuCard", mainMenuCard());
checkCard("mainMenuCard(settings)", mainMenuCard(DEFAULTS));
checkCard("mainMenuCard(appt off)", mainMenuCard({ ...DEFAULTS, appointment_enabled: false }));
checkCard("helpCard", helpCard(DEFAULTS));
checkCard("helpCard(appt off)", helpCard({ ...DEFAULTS, appointment_enabled: false }));
checkCard("aboutCard", aboutCard(DEFAULTS));

/* ═══ ข้อความต้อนรับทักชื่อ (30 ก.ย. 69) — สายด่วนครบ 4 เบอร์ · ไม่สัญญาว่าจะตอบในแชต · ชื่อแปลกๆ ไม่พัง ═══ */
const wm = welcomeMessage("สมชาย", DEFAULTS);
checkCard("welcomeMessage", wm);
assert.ok(wm.text.startsWith("สวัสดีค่ะ คุณสมชาย"), "welcomeMessage: ต้องทักชื่อ");
for (const h of HOTLINES) assert.ok(wm.text.includes(h.number), `welcomeMessage: ไม่มีสายด่วน ${h.number}`);
assert.ok(wm.text.includes(DEFAULTS.phone), "welcomeMessage: ไม่มีเบอร์ศูนย์");
assert.ok(!/ตอบ(กลับ)?ในแชต|ฝากข้อความ/.test(wm.text), "welcomeMessage: ห้ามสัญญาว่าเจ้าหน้าที่จะตอบในแชต (กฎ handoffCard)");
assert.ok(welcomeMessage(null, DEFAULTS).text.startsWith("สวัสดีค่ะ 🙏"), "welcomeMessage(null): ต้องทักแบบไม่มีชื่อ");
assert.ok(welcomeMessage("คุณแม่", DEFAULTS).text.startsWith("สวัสดีค่ะ คุณแม่"), "welcomeMessage: ชื่อขึ้นต้น 'คุณ' แล้วห้ามซ้ำ 'คุณคุณ'");
assert.equal(cleanDisplayName("  สม​ชาย\n\t "), "สมชาย", "cleanDisplayName: ต้องตัดอักขระมองไม่เห็น/ขึ้นบรรทัด");
assert.equal(cleanDisplayName("‮‏"), null, "cleanDisplayName: เหลือว่าง = null");
assert.equal(cleanDisplayName(undefined), null);
assert.ok(Array.from(cleanDisplayName("ก".repeat(80))).length <= 31, "cleanDisplayName: ต้องจำกัด 30 ตัว (+…)");

/* ═══ ปุ่มบริการ = [ภาพวิธี] + [การ์ดหลักเกณฑ์] (+ หมุดแผนที่สำหรับจองคิว) — แทน formIntroCard เดิม ═══ */
for (const kind of ["consult", "complaint", "appointment"]) {
  const r = serviceReply(kind, DEFAULTS);
  checkCard(`serviceReply:${kind}`, r);
  assert.equal(r[0].type, "image", `serviceReply:${kind} ข้อความแรกต้องเป็นภาพวิธีขอรับบริการ`);
  assert.equal(r[1].type, "flex", `serviceReply:${kind} ข้อความที่ 2 ต้องเป็นการ์ดหลักเกณฑ์`);
  const json = JSON.stringify(r[1]);
  assert.ok(json.includes(`lg:${kind}:open`), `serviceReply:${kind} ต้องมีปุ่มเปิดแบบฟอร์มผ่าน postback lg:${kind}:open`);
  assert.ok(!json.includes("?k="), `serviceReply:${kind} ห้ามฝังลิงก์ ?k= ล่วงหน้า`);
  assert.ok(r.length <= 5, "reply ส่งได้สูงสุด 5 ข้อความ");
  checkCard(`serviceGuideCard:${kind}(ป้ายยาว)`, serviceGuideCard(kind, { ...DEFAULTS, responder_label: "นิติกรหรือทนายความอาสาของสภาทนายความจังหวัดสุพรรณบุรี" }));
}
const apptReply = serviceReply("appointment", DEFAULTS);
assert.equal(apptReply[2]?.type, "location", "serviceReply:appointment ต้องแนบหมุดแผนที่ (บอสสั่ง 30 ก.ย. 69)");
assert.ok(Math.abs(apptReply[2].latitude - 14.4639) < 0.001 && Math.abs(apptReply[2].longitude - 100.1325) < 0.001, "พิกัดต้องเป็น อบจ.สุพรรณบุรี");
assert.ok(JSON.stringify(apptReply[1]).includes("ชั้น 1"), "การ์ดจองคิวต้องบอกสถานที่ (ห้อง ... ชั้น 1)");
assert.ok(JSON.stringify(apptReply[1]).includes("บัตรประจำตัวประชาชนตัวจริง"), "การ์ดจองคิวต้องมีรายการเอกสาร");
checkCard("officeLocationMessage", officeLocationMessage());
checkCard("howtoImageMessage(ไม่รู้จัก)", howtoImageMessage("xxx"));
checkCard("chatReceivedCard", chatReceivedCard(DEFAULTS.responder_label));
checkCard("helloCard", helloCard());
checkCard("handoffCard", handoffCard(DEFAULTS));
checkCard("handoffCard(ป้ายยาว)", handoffCard({ ...DEFAULTS, responder_label: "นิติกรหรือทนายความอาสาของสภาทนายความจังหวัดสุพรรณบุรี" }));
checkCard("chatReceivedCard(ป้ายยาว)", chatReceivedCard("นิติกรหรือทนายความอาสาของสภาทนายความจังหวัดสุพรรณบุรี"));
checkCard("formLinkCard:consult", formLinkCard("consult", "https://example.com/consult.html?k=abc"));
checkCard("formLinkCard:appointment", formLinkCard("appointment", "https://example.com/appointment.html?k=abc"));
checkCard("formLinkCard:addevidence", formLinkCard("addevidence", "https://example.com/add-evidence.html?k=abc&case=LG-2569-000001"));
checkCard("cancelConfirmCard", cancelConfirmCard("LG-2569-000001"));
checkCard("knowledgeCarousel", knowledgeCarousel());
checkCard("faqCard", faqCard(DEFAULTS.responder_label));
checkCard("contactCard", contactCard(DEFAULTS));
checkCard("contactCard(appointment on)", contactCard({ ...DEFAULTS, appointment_enabled: true }));
checkCard("contactCard(appointment off)", contactCard({ ...DEFAULTS, appointment_enabled: false }));
// 30 ก.ย. 69 บั๊กจริง: map_url ใน DB ถูกตัดกลาง % ("...%E0%B8%84%") → LINE ตีกลับการ์ดทั้งใบ — ต้องถอยไปใช้หมุดพิกัดจริง
const brokenMap = contactCard({ ...DEFAULTS, map_url: "https://maps.google.com/?q=%E0%B8%AD%E0%B8%87%E0%B8%84%" });
checkCard("contactCard(map_url เสีย)", brokenMap);
assert.ok(JSON.stringify(brokenMap).includes("query=14.463944178464498,100.13254896002172"), "contactCard: map_url เสียต้องใช้หมุดพิกัดจริงแทน");
assert.throws(() => assertFlexSafe({ type: "uri", label: "x", uri: "https://a.b/?q=%E0%B8%" }), /รูปแบบเสีย/, "assertFlexSafe: ต้องจับ % ไม่ครบ");
checkCard("appointmentUnavailableCard", appointmentUnavailableCard(DEFAULTS.responder_label));
checkCard("urgentCard", urgentCard());
checkCard("urgentCard(settings)", urgentCard(DEFAULTS));
for (const h of HOTLINES) assert.ok(JSON.stringify(urgentCard(DEFAULTS)).includes(`tel:${h.number}`), `urgentCard: ต้องแตะโทร ${h.number} ได้`);
checkCard("statusNotFoundCard", statusNotFoundCard());
checkCard("errorCard", errorCard());
checkCard("errorCard(custom)", errorCard("ทดสอบข้อความ error กำหนดเอง"));
checkCard("caseConfirmCard", caseConfirmCard({ case_no: "LG-2569-000001", case_type: "consult" }, DEFAULTS.responder_label));
checkCard("caseConfirmCard:appointment", caseConfirmCard({
  case_no: "LG-2569-000002", case_type: "appointment", preferred_date: "2026-09-25", preferred_time_slot: "morning",
}, DEFAULTS.responder_label));
// 30 ก.ย. 69: ฟอร์มใหม่เก็บเวลาเป็น HH:MM (migration-12) — ต้องแสดงเวลานั้น ไม่ใช่ "ช่วงเช้า/บ่าย"
const ccTime = JSON.stringify(caseConfirmCard({
  case_no: "LG-2569-000003", case_type: "appointment", preferred_date: "2026-10-01", preferred_time: "13:00", preferred_time_slot: "afternoon",
}, DEFAULTS.responder_label));
assert.ok(ccTime.includes("เวลา 13:00 น."), "caseConfirmCard: ต้องแสดง preferred_time (HH:MM) เมื่อมี");
checkCard("satisfactionRequestCard", satisfactionRequestCard({ id: 1, case_no: "LG-2569-000001" }));
checkCard("statusCard:new", statusCard({ case_no: "LG-2569-000001", status: "new", created_at: new Date().toISOString() }));
for (const s of ["assigned", "in_progress", "need_info", "closed", "withdrawn"]) {
  checkCard(`statusCard:${s}`, statusCard({ case_no: "LG-2569-000002", status: s, created_at: new Date().toISOString() }));
}
checkCard("statusCard:closed-with-resolution", statusCard({
  case_no: "LG-2569-000003", status: "closed", created_at: new Date().toISOString(), resolution_paths: ["U123/a.jpg", "U123/b.pdf"],
}));
for (const t of TOPICS) checkCard(`topicCard:${t.key}`, topicCard(t, DEFAULTS.responder_label));
// การ์ดข้อความใต้รูปประกาศ (broadcast.html — 24 ก.ย. 69) ตรวจกรณียาวสุดละเอียดใน test-broadcast.mjs อีกชั้น
checkCard("broadcastCaptionCard", broadcastCaptionCard("ขอเชิญประชาชนรับคำปรึกษากฎหมายฟรี\nทุกวันจันทร์–ศุกร์", null));
checkCard("broadcastCaptionCard(link)", broadcastCaptionCard("ข่าวประชาสัมพันธ์", "https://example.com/news?id=1"));
checkCard("broadcastCaptionCard(link only)", broadcastCaptionCard("", "https://example.com/news"));
checkCard("broadcastCaptionCard(max)", broadcastCaptionCard("ก".repeat(1000), "https://example.com/" + "a".repeat(900)));

/* ═══ รับเรื่องทางแชต (2 ต.ค. 69) — การ์ดใหม่ทุกใบผ่านเพดาน/assertFlexSafe · ปุ่มส่งครบ · ลงท้าย "ค่ะ/คะ" (มติบอส)
   · ⛔ ไม่สัญญาว่าจะมีคนตอบในแชต · ปุ่มเปิดคีย์บอร์ดไม่มี displayText (ไม่มีข้อความโผล่ในแชต) ═══ */
{
  const LONG = { ...DEFAULTS, responder_label: "นิติกรหรือทนายความอาสาของสภาทนายความจังหวัดสุพรรณบุรี" };
  const sum = { texts: 3, files: 2, locations: 1, preview: "ก".repeat(59) + "…" };
  const offer = intakeOfferCard(sum, DEFAULTS, { openCaseNo: "LG-2569-000123" });
  checkCard("intakeOfferCard", offer);
  checkCard("intakeOfferCard(ป้ายยาว+ไม่มีเรื่องเดิม)", intakeOfferCard(sum, LONG));
  checkCard("intakeOfferCard(จองคิวปิด)", intakeOfferCard(sum, { ...DEFAULTS, appointment_enabled: false }));
  const offerJson = JSON.stringify(offer);
  for (const d of ["lg:intake:consult", "lg:intake:appointment", "lg:intake:complaint", "lg:intake:append:LG-2569-000123"]) {
    assert.ok(offerJson.includes(`"${d}"`), `intakeOfferCard: ต้องมีปุ่ม ${d}`);
  }
  assert.ok(offerJson.includes("การกดส่งเรื่อง ถือว่ายินยอมให้ศูนย์ฯ ใช้ข้อมูลเพื่อติดต่อกลับและช่วยเหลือตามคำขอ"), "intakeOfferCard: ต้องมีบรรทัด PDPA ตามสเปก");
  assert.ok(!JSON.stringify(intakeOfferCard(sum, { ...DEFAULTS, appointment_enabled: false })).includes("lg:intake:appointment"), "จองคิวปิด = ไม่มีปุ่มขอนัดพบ");
  assert.ok(!JSON.stringify(intakeOfferCard(sum, DEFAULTS)).includes("lg:intake:append"), "ไม่มีเรื่องเดิม = ไม่มีปุ่มเพิ่มเข้าเรื่อง");
  checkCard("intakeEmptyCard", intakeEmptyCard(DEFAULTS));
  checkCard("intakeEmptyCard(forAppend)", intakeEmptyCard(DEFAULTS, { forAppend: true }));
  const phoneCard = intakePhoneCard(DEFAULTS);
  checkCard("intakePhoneCard", phoneCard);
  checkCard("intakePhoneCard(reminder+appointment+ป้ายยาว)", intakePhoneCard(LONG, { reminder: true, type: "appointment" }));
  const pj = JSON.stringify(phoneCard);
  assert.ok(pj.includes("lg:intake:skipphone") && pj.includes("lg:intake:cancel"), "intakePhoneCard: ต้องมีปุ่มข้าม/ยกเลิก");
  const typeBtn = phoneCard.contents.footer.contents[0].contents[0].action;
  assert.equal(typeBtn.inputOption, "openKeyboard", "ปุ่มพิมพ์เบอร์ต้องเปิดคีย์บอร์ด (ริชเมนูบังช่องพิมพ์)");
  assert.equal(typeBtn.data, "lg:intake:type", "ปุ่มพิมพ์เบอร์ = postback เงียบ");
  assert.ok(!("displayText" in typeBtn), "ปุ่มเปิดคีย์บอร์ดห้ามมี displayText (ไม่มีข้อความโผล่ในแชต)");
  checkCard("intakeHowtoCard(ไม่มีร่าง)", intakeHowtoCard(DEFAULTS, null));
  checkCard("intakeHowtoCard(มีร่าง+เรื่องเดิม)", intakeHowtoCard(DEFAULTS, sum, { openCaseNo: "LG-2569-000123" }));
  assert.ok(JSON.stringify(intakeHowtoCard(DEFAULTS, sum)).includes("lg:intake:consult"), "มีร่างแล้ว = การ์ดวิธีมีปุ่มส่งด้วย");
  checkCard("intakeAppendedCard", intakeAppendedCard("LG-2569-000123", { texts: 2, files: 3, dropped: 1 }, LONG));
  checkCard("intakeAppendedCard(ไฟล์อย่างเดียว)", intakeAppendedCard("LG-2569-000123", { files: 1 }, DEFAULTS));
  checkCard("intakeAlreadySentCard", intakeAlreadySentCard("LG-2569-000123"));
  for (const reason of ["type", "too_large", "failed", "full", "อื่นๆ"]) checkCard(`intakeFileNoticeText:${reason}`, intakeFileNoticeText(reason));
  // การ์ดยืนยันของเรื่องจากแชต — มีเบอร์/ไม่มีเบอร์/ขอนัดพบไม่มีวัน
  const chatRow = { case_no: "LG-2569-000124", case_type: "consult", source: "chat", citizen_phone: "0812345678", detail: "x" };
  const cc1 = JSON.stringify(caseConfirmCard(chatRow, DEFAULTS.responder_label));
  assert.ok(cc1.includes("0812345678") && cc1.includes("เพิ่มข้อมูลเข้าเรื่อง"), "caseConfirmCard(แชต): โชว์เบอร์ที่จะติดต่อกลับ + บอกวิธีเพิ่มข้อมูล");
  const cc2 = JSON.stringify(caseConfirmCard({ ...chatRow, citizen_phone: null }, DEFAULTS.responder_label));
  assert.ok(cc2.includes("แจ้งความคืบหน้าผ่านแชตนี้"), "caseConfirmCard(แชต ไม่มีเบอร์): แจ้งความคืบหน้าผ่านแชต");
  const cc3 = JSON.stringify(caseConfirmCard({ ...chatRow, case_type: "appointment", preferred_date: null }, DEFAULTS.responder_label));
  assert.ok(cc3.includes("โทรนัดวัน-เวลา"), "caseConfirmCard(แชต ขอนัดพบไม่มีวัน): เจ้าหน้าที่โทรนัด");
  const cc4 = JSON.stringify(caseConfirmCard({ ...chatRow, case_type: "appointment", preferred_date: null, citizen_phone: null }, DEFAULTS.responder_label));
  assert.ok(cc4.includes("นัดวัน-เวลาเข้าพบทนายอาสาผ่านแชตนี้"), "caseConfirmCard(แชต ขอนัดพบไม่มีเบอร์): นัดผ่านแชต");
  checkCard("caseConfirmCard:chat", caseConfirmCard(chatRow, LONG.responder_label));
  checkCard("caseConfirmCard:chat-appointment-nodate", caseConfirmCard({ ...chatRow, case_type: "appointment", preferred_date: null, citizen_phone: null }, LONG.responder_label));
  assert.ok(!JSON.stringify(caseConfirmCard({ case_no: "LG-2569-000001", case_type: "consult", source: "line", detail: "x" }, "เจ้าหน้าที่")).includes("เพิ่มข้อมูลเข้าเรื่อง"), "caseConfirmCard ของฟอร์มเดิมไม่เปลี่ยน");
  // ปุ่ม "💬 พิมพ์เล่าในแชตแทน" — ปรึกษา/ร้องเรียนเท่านั้น
  for (const k of ["consult", "complaint"]) assert.ok(JSON.stringify(serviceGuideCard(k, DEFAULTS)).includes('"lg:chatintake"'), `serviceGuideCard:${k} ต้องมีทางเลือกพิมพ์เล่าในแชต`);
  assert.ok(!JSON.stringify(serviceGuideCard("appointment", DEFAULTS)).includes("lg:chatintake"), "การ์ดจองคิวไม่ต้องมีปุ่มแชต (ต้องเลือกวัน-เวลาในฟอร์ม)");
  // ถ้อยคำ: ลงท้าย ค่ะ/คะ ไม่มี "ครับ" · ไม่สัญญาว่ามีคนตอบในแชต (กฎ handoffCard)
  const intakeAll = JSON.stringify([
    offer, intakeEmptyCard(DEFAULTS), intakeEmptyCard(DEFAULTS, { forAppend: true }), phoneCard, intakePhoneCard(DEFAULTS, { reminder: true }),
    intakeHowtoCard(DEFAULTS, sum), intakeAppendedCard("LG-2569-000123", { texts: 1 }), intakeAlreadySentCard("LG-2569-000123"),
    ...["type", "too_large", "failed", "full"].map(intakeFileNoticeText), INTAKE_BUSY_TEXT, INTAKE_CANCELLED_TEXT, INTAKE_APPT_OFF_TEXT,
  ]);
  assert.ok(!/ครับ/.test(intakeAll), "การ์ดรับเรื่องทางแชต: ห้ามใช้ ครับ / ค่ะ/ครับ (มติบอส 2 ต.ค. 69)");
  assert.ok(!/ตอบ(กลับ)?ในแชต|จะตอบในแชต/.test(intakeAll + cc1 + cc2 + cc3 + cc4), "การ์ดรับเรื่องทางแชต: ห้ามสัญญาว่าเจ้าหน้าที่จะตอบในแชต");
  for (const t of [INTAKE_BUSY_TEXT, INTAKE_CANCELLED_TEXT, INTAKE_APPT_OFF_TEXT, ...["type", "too_large", "failed", "full"].map((r) => intakeFileNoticeText(r).text)]) {
    assert.ok(/(ค่ะ|คะ)$/.test(t), `ข้อความต้องลงท้าย ค่ะ/คะ: "${t}"`);
  }
}

/* ═══ 2 ต.ค. 69 — ต้อนรับใหม่ [ทักชื่อ → โปสเตอร์ v2 (รูปแยก) → การ์ดไม่มีรูปใหญ่] · เบอร์ศูนย์ 035-431-751 · บอทพูด "ค่ะ" ทั้งระบบ ═══ */
{
  const { welcomePosterMessage, WELCOME_POSTER, greetingCard: gc, errorCard: ec } = await import("../api/_cards.js");
  const fs = await import("node:fs");
  const poster = welcomePosterMessage();
  assert.equal(poster.type, "image", "ต้อนรับ: โปสเตอร์ต้องเป็น image message");
  for (const k of ["originalContentUrl", "previewImageUrl"]) {
    assert.ok(/^https:\/\/[^\s]+\.jpg\?v=\d+$/.test(poster[k]), `ต้อนรับ: ${k} ต้องเป็น https .jpg + ?v= (ไลน์แคชตาม URL)`);
  }
  const fullBytes = fs.statSync(new URL("../public/" + WELCOME_POSTER.full, import.meta.url)).size;
  const prevBytes = fs.statSync(new URL("../public/" + WELCOME_POSTER.preview, import.meta.url)).size;
  assert.ok(fullBytes <= 10 * 1024 * 1024, "โปสเตอร์ต้อนรับ ≤ 10MB (เพดาน LINE)");
  assert.ok(prevBytes <= 1024 * 1024, "ภาพย่อโปสเตอร์ ≤ 1MB (เพดาน LINE)");
  for (const s of [DEFAULTS, { ...DEFAULTS, appointment_enabled: false }]) {
    const g = gc("สมชาย", s);
    checkCard("greetingCard(2 ต.ค.)", g);
    assert.ok(!g.contents.hero, "การ์ดต้อนรับต้องไม่มีรูปใหญ่ (บอสสั่ง 2 ต.ค. 69 — โปสเตอร์ส่งเป็นรูปแยก)");
    assert.ok(JSON.stringify(g).includes("lg:chatintake"), "การ์ดต้อนรับต้องมีช่องแจ้งเรื่องทางแชต");
  }
  assert.equal(DEFAULTS.phone, "035-431-751", "เบอร์ศูนย์ (มติบอส 2 ต.ค. 69)");
  assert.ok(JSON.stringify(ec()).includes("035-431-751"), "errorCard ต้องใช้เบอร์ศูนย์ใหม่");
  // บอทพูด "ค่ะ" ทั้งระบบ — สแกนซอร์สข้อความที่ประชาชนเห็น (ตัดคอมเมนต์ทิ้ง · _chatgate/_chatintake มี regex อ่านคำที่ผู้ใช้พิมพ์ จึงไม่สแกน)
  for (const f of ["../api/_cards.js", "../api/line-webhook.js"]) {
    const code = fs.readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/ครับ/.test(code), `${f}: ข้อความฝั่งประชาชนห้ามมี "ครับ" / "ค่ะ/ครับ" (มติบอส 2 ต.ค. 69 บอทพูด "ค่ะ")`);
  }
}

console.log(`✅ test-cards.mjs ผ่านทั้งหมด (${checked} การ์ด)`);
