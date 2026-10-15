/* api/line-webhook.js — รับ event LINE ทั้งหมด (follow / message / postback)
   ปิด bodyParser อัตโนมัติของ Vercel เพราะต้องได้ raw body ไปตรวจลายเซ็นก่อน parse JSON

   ⛔ เขียนใหม่ 17 ก.ย. 69 รอบ 3 — บอสสั่ง "ให้ฝั่ง LINE OA เป็นของประชาชนไปเลย" จึงตัดคำสั่ง/postback
   ของเจ้าหน้าที่-แอดมินออกทั้งหมด (เดิมมี #ขอสิทธิ์เจ้าหน้าที่/#หลังบ้าน/#จัดการเจ้าหน้าที่/#ถอนสิทธิ์/
   #ตั้งค่า และปุ่มอนุมัติ/ปฏิเสธผ่าน postback) — เจ้าหน้าที่ทั้งหมดย้ายไปสมัคร/ล็อกอินเว็บด้วยอีเมล+
   รหัสผ่าน+OTP แทน (ดู api/staff-auth.js) ไฟล์นี้เหลือไว้ให้ "ประชาชน" ใช้งานล้วนๆ + คำสั่งลับเดียวที่เหลือ
   คือ #เชื่อม <รหัส> สำหรับเจ้าหน้าที่ที่อยากผูก LINE ไว้รับแจ้งเตือนเสริมแบบไม่บังคับเท่านั้น */
export const config = { api: { bodyParser: false } };

import { verifySignature, reply, push, pushAllowed, getProfile, showLoading, markAsRead } from "./_lineapi.js";
import { db } from "./_db.js";
import { getSettings } from "./_settings.js";
import { getTopic } from "./_keywords.js";
import { makeFormToken } from "./_formauth.js";
import { notifiableStaff } from "./_staffauth.js";
import {
  getCaseByNo, getCaseById, recordSatisfaction, updateStatus, createCase, latestOpenCaseOf, appendChatSubmission,
  MAX_TOTAL_EVIDENCE, OPEN_STATUSES,
} from "./_cases.js";
import { getEvidenceViewUrl } from "./_evidence.js";
import {
  routeText, needsLoadingIndicator, createCardGate, keywordLogStore, isIntakeContent,
  FALLBACK_KIND, GREET_KIND, HUMAN_KIND, FILE_NOTE_KIND, QUIET_WINDOW_MS, SILENT_POSTBACKS,
} from "./_chatgate.js";
import {
  createChatIntake, ingestLineMedia, locationItemText, extractPhone, isPhoneOnly, summarizeDraft, hasSubstance, draftText,
  buildCaseDetail, buildAppendNote, guessCategory, INTAKE_TYPES, MAX_DRAFT_FILES,
} from "./_chatintake.js";
import { notifyStaff, notifyCaseUpdate } from "./_notify.js";
import {
  greetingCard, welcomeMessage, welcomePosterMessage, cleanDisplayName, mainMenuCard, helpCard, aboutCard, chatReceivedCard, helloCard, handoffCard,
  serviceReply, formLinkCard, topicCard, knowledgeCarousel, faqCard, contactCard, urgentCard, statusCard, statusNotFoundCard,
  errorCard, appointmentUnavailableCard, cancelConfirmCard, TRACK_PROMPT_TEXT, caseConfirmCard,
  intakeOfferCard, intakeEmptyCard, intakePhoneCard, intakeHowtoCard, intakeAppendedCard, intakeAlreadySentCard, intakeFileNoticeText,
  INTAKE_BUSY_TEXT, INTAKE_CANCELLED_TEXT, INTAKE_APPT_OFF_TEXT,
} from "./_cards.js";

// การ์ดที่ตอบข้อความพิมพ์คุยเอง/หมวดกฎหมาย ส่งซ้ำให้คนเดิมได้ไม่เกิน 1 ครั้งต่อ QUIET_WINDOW_MS (ดู _chatgate.js)
const cardGate = createCardGate(keywordLogStore);
// 2 ต.ค. 69 รับเรื่องทางแชต — ร่างเรื่องต่อผู้ใช้ (ตาราง chat_drafts · ยังไม่รัน migration-14 = ถอยไปพฤติกรรมเดิมเอง)
const intake = createChatIntake();
// webhook มี maxDuration 30 วิ (vercel.json) — โหลดไฟล์จากไลน์ต้องเสร็จก่อนเส้นนี้ (เผื่อเวลาตอบ/บันทึกท้ายงาน)
const REQUEST_BUDGET_MS = 25 * 1000;

/* ═══ กันประมวลผลซ้ำเมื่อ LINE retry (ไม่ตอบ 200 ทันเวลา) — เก็บ event id สั้นๆ ต่ออินสแตนซ์ ═══ */
const seenEvents = new Map();
const SEEN_TTL_MS = 5 * 60 * 1000;
function alreadySeen(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seenEvents) if (now - t > SEEN_TTL_MS) seenEvents.delete(k);
  if (seenEvents.has(id)) return true;
  seenEvents.set(id, now);
  return false;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");

  const raw = await readRawBody(req);
  const sig = req.headers["x-line-signature"];
  if (!verifySignature(raw, sig)) {
    console.error("line-webhook: signature ไม่ตรง ปฏิเสธ request");
    return res.status(401).send("bad signature");
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).send("bad json");
  }

  // ตอบ 200 ให้ LINE ก่อนเสมอหลังประมวลผล (LINE รอ 200 ภายในเวลาสั้นๆ ไม่งั้น retry รัว)
  const deadline = Date.now() + REQUEST_BUDGET_MS; // 2 ต.ค. 69: งบเวลาทั้งคำขอ (หลายรูปในคำขอเดียวโหลดทีละไฟล์)
  try {
    for (const event of body.events || []) {
      if (alreadySeen(event.webhookEventId)) continue;
      await handleEvent(event, { deadline }).catch((e) => console.error("handleEvent error", e));
    }
  } catch (e) {
    console.error("line-webhook: unexpected error", e);
  }
  res.status(200).send("ok");
}

async function handleEvent(event, { deadline = Date.now() + REQUEST_BUDGET_MS } = {}) {
  const uid = event.source?.userId;

  // mark อ่านแล้วทุกข้อความ (คนพิมพ์รู้ว่าถึงแล้วแม้บอทจะเงียบไว้) + "กำลังพิมพ์..." เฉพาะ event ที่ตอบแน่และต้องรอ DB
  // ⛔ 28 ก.ย. 69 เลิกโชว์ "กำลังพิมพ์..." กับทุกข้อความ — ข้อความคุยทั่วไปบอทอาจเงียบตาม _chatgate.js ถ้าโชว์ไว้
  // ผู้ใช้จะเห็นจุดสามจุดค้าง 20 วิแล้วไม่มีอะไรตอบ — เฉพาะแชต 1:1 (มี userId)
  if (uid && event.source?.type === "user" && (event.type === "postback" || event.type === "message")) {
    const acks = [];
    if (needsLoadingIndicator(event)) acks.push(showLoading(uid));
    if (event.type === "message" && event.message?.markAsReadToken) acks.push(markAsRead(event.message.markAsReadToken));
    await Promise.all(acks);
  }

  // ⛔ ห้ามพังเงียบ (SPEC.md ข้อ 7) — ถ้า handler ด้านล่าง throw ไม่ว่าเหตุผลอะไร ต้องตอบ errorCard()
  // กลับไปเสมอ ไม่ปล่อยให้ผู้ใช้เห็นความเงียบ
  try {
    if (event.type === "follow") return await handleFollow(event, uid);
    if (event.type === "postback") return await handlePostback(event, uid);
    if (event.type === "message" && event.message?.type === "text") return await handleText(event, uid);
    if (event.type === "message") {
      // สติกเกอร์ = ขอบคุณ/รับทราบ/อารมณ์ท้ายบทสนทนาเกือบทั้งหมด → ไม่ตอบ (เดิมได้การ์ดเมนูเด้งทุกดวง)
      if (event.message?.type === "sticker") return;
      // ⛔ 2 ต.ค. 69 ทับกติกา 28 ก.ย. 69 "รูป/ไฟล์ที่ส่งลอยๆ ไม่เก็บ" — รับเรื่องทางแชต: รูป/PDF เก็บเข้าร่าง (bucket evidence)
      // วิดีโอ/เสียง/ชนิดอื่นจดโน้ตให้เจ้าหน้าที่ · พิกัดเก็บเป็นข้อความ (ดู handleMedia) — ยังไม่รัน migration-14 = แบบเดิม
      return await handleMedia(event, uid, deadline);
    }
    // unfollow / join / leave ฯลฯ — log ไว้เฉยๆ ไม่ต้องตอบอะไร
  } catch (e) {
    console.error("handleEvent: ตอบไม่ได้ ส่ง errorCard กลับแทนกันพังเงียบ", e);
    if (event.replyToken) await replySafe(event.replyToken, errorCard()).catch(() => {});
  }
}

// คืน true เมื่อ LINE รับข้อความจริง (replyOncePerWindow ใช้ตัดสินว่าจะนับว่า "ส่งการ์ดแล้ว" หรือคืนสิทธิ์)
async function replySafe(token, card) {
  try {
    return await reply(token, card); // reply() clamp ให้เองข้างในแล้ว (ดู _lineapi.js) ไม่ต้อง clamp ซ้ำที่นี่
  } catch (e) {
    console.error("replySafe failed", e);
    return false;
  }
}

/* ส่งการ์ดครั้งเดียวต่อคนต่อ QUIET_WINDOW_MS (บอสแจ้ง 28 ก.ย. 69 การ์ดเมนูเด้งทุกข้อความ) — ครั้งถัดไปเงียบ
   ไม่ตอบอะไร (อ่านแล้วถูก mark ไปตั้งแต่ handleEvent) · ส่งไม่สำเร็จคืนสิทธิ์ให้ข้อความถัดไปลองใหม่
   ⚠️ ใช้กับข้อความที่ผู้ใช้ "ไม่ได้ขอ" การ์ดนั้นตรงๆ เท่านั้น — ปุ่ม/เลขที่เรื่อง/คำเร่งด่วน/พิมพ์ "เมนู" ต้องตอบทุกครั้ง */
async function replyOncePerWindow(event, uid, kind, card, rawText = null) {
  return replyGated(event, uid, [{ kind, card, rawText }]);
}

/* หลายการ์ดที่มีตัวกั้นคนละชนิดในการตอบครั้งเดียว (2 ต.ค. 69 — ส่งไฟล์ที่ระบบไม่รับครั้งแรก = [แจ้งเหตุผล] + [การ์ดรับเรื่อง])
   card เป็นฟังก์ชัน async ได้ (สร้างเฉพาะตอนผ่านตัวกั้นจริง — ไม่ยิง DB หาเรื่องเดิมทุกข้อความที่เงียบอยู่แล้ว)
   entry ที่ไม่มี kind = ไม่ผ่านตัวกั้น (ผู้เรียกจองสิทธิ์มาเองแล้ว เช่น เตือนขอเบอร์ด้วย claimPhoneNudge) */
async function replyGated(event, uid, entries) {
  const passed = [];
  for (const en of entries) {
    if (!en.kind || (await cardGate.claim(uid, en.kind))) passed.push(en);
    else console.log(`line-webhook: เงียบไว้ ส่งการ์ด ${en.kind} ให้ผู้ใช้นี้ไปแล้วภายใน ${QUIET_WINDOW_MS / 3600000} ชม.`);
  }
  if (!passed.length) return;
  const releaseAll = () => passed.forEach((en) => en.kind && cardGate.release(uid, en.kind));
  let msgs;
  try {
    msgs = (await Promise.all(passed.map((en) => (typeof en.card === "function" ? en.card() : en.card)))).flat();
  } catch (e) {
    releaseAll();
    throw e;
  }
  if (!(await replySafe(event.replyToken, msgs))) return releaseAll();
  for (const en of passed) if (en.kind) await cardGate.confirm(uid, en.kind, en.rawText ?? null);
}

/* บอสสั่ง 16 ก.ย. 69: ทักชื่อไลน์คนที่แอดใหม่
   ⛔ 30 ก.ย. 69 (งาน T1a) ทับชุดเดิม [greetingCard + contactCard]: ตอบ [ข้อความต้อนรับทักชื่อ + เวลาทำการ + เบอร์ศูนย์ +
   สายด่วน 4 เบอร์] + [การ์ดต้อนรับมีภาพหัว + ปุ่มลัด 3 ปุ่ม] แบบ "ตัวอย่าง ข้อความต้อนรับ.jpg" (ทต.หนองป่าครั่ง)
   getProfile: timeout สั้น 2.5 วิ ไม่ retry (ดึงไม่ทัน/ไม่สำเร็จ = คืน null → ทัก "สวัสดีค่ะ" เฉยๆ ไม่ throw)
   ชื่อผ่าน cleanDisplayName() เสมอ (ตัดอักขระควบคุม/มองไม่เห็น ยุบช่องว่าง จำกัด 30 ตัว) */
async function handleFollow(event, uid) {
  const [profile, settings] = await Promise.all([getProfile(uid, { timeout: 2500, retries: 0 }), getSettings()]);
  const name = cleanDisplayName(profile?.displayName);
  // 2 ต.ค. 69: [ทักชื่อ] → [โปสเตอร์ v2 เป็นรูปแยก] → [การ์ดปุ่มลัดไม่มีรูปใหญ่] (บอสสั่ง "ไม่ต้องใส่รูปใน card flex ให้ส่งเป็นรูป v2 ไปแทน")
  await replySafe(event.replyToken, [welcomeMessage(name, settings), welcomePosterMessage(), greetingCard(name, settings)]);
}

/* ═══ postback ที่ตอบได้ทันทีโดยไม่ต้องรู้ uid/ไม่แตะ DB (นอกจาก settings) — ฟังก์ชันบริสุทธิ์ ═══
   แยกออกมา 30 ก.ย. 69 ให้ scripts/test-richmenu.mjs ยืนยันได้ว่า "ทุกปุ่มในริชเมนู v2 มีคนตอบแน่นอน" และรหัสเดิม
   (lg:consult/complaint/knowledge/faq/contact/appointment/menu/kw:*) ยังตอบได้ — การ์ดเก่าในแชต + ริชเมนู v1
   คืน null = ไม่ใช่ postback กลุ่มนี้ (ให้ handlePostback จัดการต่อ) */
export function simplePostbackReply(data, settings) {
  switch (data) {
    case "lg:consult":
    case "lg:complaint":
      // ปุ่มบริการ = [ภาพวิธีขอรับบริการ] + [การ์ดหลักเกณฑ์] (บอสสั่ง 30 ก.ย. 69 แบบ ทต.หนองป่าครั่ง)
      return serviceReply(data.slice(3), settings);
    case "lg:appointment":
      if (!settings.appointment_enabled) return appointmentUnavailableCard(settings.responder_label);
      return serviceReply("appointment", settings);
    case "lg:knowledge": return knowledgeCarousel();
    case "lg:faq": return faqCard(settings.responder_label);
    case "lg:contact": return contactCard(settings);
    case "lg:menu": return mainMenuCard(settings);
    // ปุ่มใหม่ของริชเมนู v2 (30 ก.ย. 69)
    case "lg:help": return helpCard(settings);
    case "lg:about": return aboutCard(settings);
    case "lg:urgent": return urgentCard(settings);
    // ติดตามเรื่อง — ปุ่มเปิดคีย์บอร์ดให้แล้ว ตอบแบบเดียวกับที่ผู้ใช้พิมพ์ "ติดตามสถานะ"
    case "lg:track": return { type: "text", text: TRACK_PROMPT_TEXT };
  }
  if (data.startsWith("lg:kw:")) {
    const topic = getTopic(data.slice(6));
    return topic ? topicCard(topic, settings.responder_label) : mainMenuCard(settings);
  }
  return null;
}

/* ═══ postback ═══ */
async function handlePostback(event, uid) {
  const data = event.postback?.data || "";
  const settings = await getSettings();

  const simple = simplePostbackReply(data, settings);
  if (simple) return replySafe(event.replyToken, simple);

  // ═══ รับเรื่องทางแชต (2 ต.ค. 69) — ปุ่มในการ์ด intakeOfferCard/intakePhoneCard/intakeHowtoCard ═══
  if (SILENT_POSTBACKS.has(data)) return; // ปุ่มเปิดคีย์บอร์ดให้พิมพ์ต่อ (lg:intake:type) — ตั้งใจไม่ตอบ ข้อความที่พิมพ์ตามมาเข้าร่างเอง
  if (data === "lg:chatintake") return handleChatIntakeHowto(event, uid, settings);
  if (data.startsWith("lg:intake:")) return handleIntakePostback(event, uid, data.slice("lg:intake:".length), settings);

  if (data === "lg:consult:open" || data === "lg:complaint:open" || data === "lg:appointment:open") {
    const kind = data.split(":")[1];
    // เช็คสวิตช์ appointment_enabled ซ้ำตรงนี้ด้วย (ไม่ใช่แค่ตอนกด lg:appointment ครั้งแรก) — กันกรณี
    // แอดมินปิดสวิตช์ระหว่างที่การ์ดแนะนำฟอร์มเก่ายังค้างอยู่ในแชตของผู้ใช้ แล้วผู้ใช้กด "เปิดแบบฟอร์ม"
    // ต่อจากการ์ดเก่านั้น (พบจากรีวิวความปลอดภัย 18 ก.ย. 69 — ไม่มีคนแจ้ง)
    if (kind === "appointment" && !settings.appointment_enabled) {
      return replySafe(event.replyToken, appointmentUnavailableCard(settings.responder_label));
    }
    const tok = makeFormToken(uid, kind);
    const url = `${process.env.SITE_URL || "https://suphan-legalaid.vercel.app"}/${kind}.html?k=${tok}`;
    return replySafe(event.replyToken, formLinkCard(kind, url));
  }

  if (data.startsWith("lg:status:")) {
    return handleStatusLookup(event, uid, data.slice("lg:status:".length));
  }

  if (data.startsWith("lg:rate:")) {
    const parts = data.split(":");
    return handleSatisfactionRate(event, uid, Number(parts[2]), Number(parts[3]));
  }

  // ═══ เพิ่ม 17 ก.ย. 69 แนวคิดจาก Traffy Fondue — ยกเลิกเรื่องเอง/แนบหลักฐานเพิ่ม/ดูเอกสารผลดำเนินการ ═══
  if (data.startsWith("lg:addevidence:")) {
    return handleAddEvidenceRequest(event, uid, data.slice("lg:addevidence:".length));
  }
  if (data.startsWith("lg:cancelconfirm:")) {
    return handleCancelConfirm(event, uid, data.slice("lg:cancelconfirm:".length));
  }
  if (data.startsWith("lg:cancel:")) {
    return handleCancelRequest(event, uid, data.slice("lg:cancel:".length));
  }
  if (data.startsWith("lg:resfile:")) {
    return handleResolutionFiles(event, uid, data.slice("lg:resfile:".length));
  }

  return replySafe(event.replyToken, mainMenuCard(settings));
}

async function handleStatusLookup(event, uid, caseNo) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row) return replySafe(event.replyToken, statusNotFoundCard());
  // ต้องตรงกันเสมอแบบ exact match (ไม่ใช่ "ข้ามเช็คถ้า citizen_line_uid ว่าง") — ในทางปฏิบัติ
  // citizen_line_uid มีค่าเสมอเพราะบันทึกเรื่องได้ต้องผ่านลิงก์ฟอร์มที่ออกจาก uid จริงเท่านั้น
  // (ดู api/_formauth.js) แต่เขียนแบบ fail-closed ไว้กันโค้ดอนาคตเปลี่ยนแล้วช่องโหว่นี้โผล่แบบไม่ตั้งใจ
  if (row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  return replySafe(event.replyToken, statusCard(row));
}

/* ═══ แนบหลักฐานเพิ่ม/ยกเลิกเรื่องเอง/ดูเอกสารผลดำเนินการ (แนวคิดจาก Traffy Fondue เพิ่ม 17 ก.ย. 69) ═══
   ทั้ง 4 ฟังก์ชันตรวจสิทธิ์แบบเดียวกับ handleStatusLookup เสมอ (citizen_line_uid ต้องตรงกับ uid จริง) */
async function handleAddEvidenceRequest(event, uid, caseNo) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  if (row.status === "closed" || row.status === "withdrawn") {
    return replySafe(event.replyToken, errorCard("เรื่องนี้ปิด/ยกเลิกแล้ว ไม่สามารถแนบหลักฐานเพิ่มได้ กรุณาติดต่อเจ้าหน้าที่โดยตรงหากจำเป็น"));
  }
  const tok = makeFormToken(uid, "addevidence");
  const url = `${process.env.SITE_URL || "https://suphan-legalaid.vercel.app"}/add-evidence.html?k=${tok}&case=${encodeURIComponent(caseNo)}`;
  return replySafe(event.replyToken, formLinkCard("addevidence", url));
}

async function handleCancelRequest(event, uid, caseNo) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  if (row.status !== "new") {
    return replySafe(event.replyToken, errorCard("ยกเลิกเรื่องนี้เองไม่ได้แล้ว (มีเจ้าหน้าที่รับเรื่องแล้ว) กรุณาติดต่อเจ้าหน้าที่โดยตรง"));
  }
  return replySafe(event.replyToken, cancelConfirmCard(caseNo));
}

async function handleCancelConfirm(event, uid, caseNo) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  if (row.status !== "new") {
    return replySafe(event.replyToken, errorCard("ยกเลิกเรื่องนี้เองไม่ได้แล้ว (มีเจ้าหน้าที่รับเรื่องแล้ว) กรุณาติดต่อเจ้าหน้าที่โดยตรง"));
  }
  await updateStatus(row.id, "withdrawn", "citizen", "ยกเลิกโดยผู้แจ้งเรื่องเอง");
  await replySafe(event.replyToken, { type: "text", text: `ยกเลิกเรื่อง ${caseNo} แล้ว ขอบคุณที่แจ้งให้ทราบค่ะ` });
  // แจ้งเจ้าหน้าที่เบาๆ (ไม่เร่งด่วน) กันเจ้าหน้าที่ไล่ตามเรื่องที่ถูกยกเลิกไปแล้วโดยไม่รู้ตัว —
  // เฉพาะคนที่ผูก LINE ไว้แบบไม่บังคับเท่านั้น (ส่วนใหญ่เห็นจากอีเมล/หน้าเว็บแทน)
  const eligible = await notifiableStaff(row.category);
  const targets = eligible.filter((s) => s.notify_line && s.line_uid).map((s) => s.line_uid);
  if (targets.length && (await pushAllowed("normal"))) {
    await Promise.all(targets.map((u) => push(u, { type: "text", text: `ℹ️ เรื่อง ${caseNo} ถูกยกเลิกโดยผู้แจ้งเอง` }).catch(() => {})));
  }
}

async function handleResolutionFiles(event, uid, caseNo) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  const paths = row.resolution_paths || [];
  if (!paths.length) return replySafe(event.replyToken, { type: "text", text: "ยังไม่มีเอกสารผลการดำเนินการแนบมา" });
  const urls = await Promise.all(paths.map((p) => getEvidenceViewUrl(p)));
  const lines = urls.map((u, i) => (u ? `${i + 1}. ${u}` : null)).filter(Boolean);
  if (!lines.length) return replySafe(event.replyToken, errorCard());
  return replySafe(event.replyToken, { type: "text", text: `เอกสารผลการดำเนินการ (ลิงก์ใช้ได้ 10 นาที):\n${lines.join("\n")}` });
}

/* ═══ ข้อความ ═══ */
/* ลำดับการตัดสินอยู่ใน routeText() (_chatgate.js) ที่เดียว — ทดสอบออฟไลน์ได้ใน scripts/test-chatgate.mjs
   2 ต.ค. 69 รับเรื่องทางแชต: โหลดร่างก่อน (ระหว่างรอเบอร์ routeText ต้องตรวจเบอร์ก่อนพจนานุกรมเจตนา) · ข้อความที่มีเนื้อหา
   (isIntakeContent) เข้าร่างเงียบๆ แล้วค่อยตัดสินว่าจะตอบการ์ดอะไร · ยังไม่รัน migration-14/DB ล่ม = พฤติกรรมเดิมทุกอย่าง */
async function handleText(event, uid) {
  const text = (event.message.text || "").trim();
  const ctx = intakeAllowed(event, uid) ? await intake.load(uid) : { ok: false, reason: "nouid" };
  const awaitingPhone = ctx.ok && ctx.draft.awaiting === "phone";
  const route = routeText(text, { awaitingPhone });

  switch (route.kind) {
    // เลขที่เรื่อง — พิมพ์มาตรงๆ หรือปนในประโยค ("ขอดูสถานะ LG-2569-000123 ครับ") ไม่ต้องกดปุ่มก่อน
    case "status":
      return handleStatusLookup(event, uid, route.caseNo);
    // คำสั่งลับเดียวที่เหลืออยู่ — เชื่อมบัญชี LINE แบบไม่บังคับสำหรับเจ้าหน้าที่ (ดู #เชื่อม ด้านล่าง)
    // คำสั่งเจ้าหน้าที่/แอดมินอื่นทั้งหมดตัดออกแล้ว 17 ก.ย. 69 รอบ 3 (ย้ายไปเว็บ staff-login.html ทั้งหมด)
    case "link":
      return handleLinkLineCommand(event, uid, route.code);
    case "track":
      return replySafe(event.replyToken, { type: "text", text: TRACK_PROMPT_TEXT });
    case "caseFormat":
      return replySafe(event.replyToken, { type: "text", text: "รูปแบบเลขที่เรื่องไม่ครบ กรุณาพิมพ์ให้ตรงตามการ์ดยืนยันรับเรื่อง เช่น LG-2569-000123" });
    // พิมพ์ขอเมนูเอง → ให้ทุกครั้ง (ทางเดียวที่ผู้ใช้เรียกการ์ดเมนูกลับมาได้ระหว่างที่บอทเงียบไว้)
    case "menu":
      return replySafe(event.replyToken, mainMenuCard(await getSettings()));
    // คำเร่งด่วนตอบทุกครั้ง ไม่ผ่านตัวกั้นซ้ำ (ความปลอดภัยมาก่อนความรำคาญ) และไม่ต่อด้วยหมวดกฎหมาย
    // เพื่อไม่ให้ข้อความรกจนพลาดเบอร์ฉุกเฉิน
    // 30 ก.ย. 69: การ์ดสายด่วนแสดงเบอร์ศูนย์จาก settings ด้วย (getSettings ไม่ throw — DB ล่มได้ค่า DEFAULTS)
    case "urgent":
      return replySafe(event.replyToken, urgentCard(await getSettings()));
    // ขอบคุณ/โอเค/รับทราบ ล้วนๆ — ไม่ตอบ (เดิมได้การ์ด "ขออภัย ยังไม่เข้าใจ" + เมนูหลักกลับไปทุกครั้ง)
    case "courtesy":
      return;
  }

  const settings = await getSettings();

  // ═══ รับเรื่องทางแชต (2 ต.ค. 69) ═══
  // ระหว่างรอเบอร์: พิมพ์เบอร์ = ส่งเรื่องทันที · "ไม่มีเบอร์/ข้าม" = ส่งแบบไม่มีเบอร์
  if (route.kind === "phone") return intakeTypedPhone(event, uid, text, route.phone, ctx.draft, settings);
  if (route.kind === "phoneSkip") return intakeSkipPhone(event, uid, settings);
  // ข้อความที่มีเนื้อหาเรื่อง → เก็บเข้าร่างเงียบๆ (ทักทาย/ขอบคุณ/ขอเบอร์/faq/ความรู้/ขอคุยกับคน ไม่เข้าร่าง)
  let draft = null;
  if (ctx.ok && isIntakeContent(route)) {
    try {
      draft = (await intake.append(uid, [{ t: "text", text }])).draft;
    } catch (e) {
      console.error("intake: เก็บข้อความเข้าร่างไม่ได้ — ตอบแบบเดิม", e?.code || e?.message || e);
    }
    // ระหว่างรอเบอร์ ข้อความอื่นเก็บรวมไว้ แล้วเตือนขอเบอร์ไม่เกิน 1 ครั้ง/10 นาที (ไม่ตอบการ์ดบริการ/หมวดแทรก)
    if (draft && awaitingPhone) return nudgePhone(event, uid, draft, settings);
  }

  // 🧭 เจตนาจากพจนานุกรม (_chatgate.js matchIntent) — ขอข้อมูลตรงๆ ตอบทุกครั้ง (เหมือนกดปุ่ม) ·
  // ทักทายกับขอคุยกับคนผ่านตัวกั้นซ้ำ (คนทักซ้ำ/ถามว่ามีคนอยู่ไหมซ้ำๆ ระหว่างรอ ไม่ได้การ์ดเดิมทุกประโยค)
  switch (route.kind) {
    case "contact":
      return replySafe(event.replyToken, contactCard(settings));
    // 30 ก.ย. 69: พิมพ์ขอปรึกษา/ร้องเรียน/จองคิว ตอบชุดเดียวกับกดปุ่มบริการ ([ภาพวิธี] + [การ์ดหลักเกณฑ์]) แทน formIntroCard เดิม
    case "consult":
    case "complaint":
    case "appointment":
      return replySafe(event.replyToken, simplePostbackReply("lg:" + route.kind, settings));
    case "faq":
      return replySafe(event.replyToken, faqCard(settings.responder_label));
    case "knowledge":
      return replySafe(event.replyToken, knowledgeCarousel());
    case "greet":
      return replyOncePerWindow(event, uid, GREET_KIND, helloCard());
    case "human":
      return replyOncePerWindow(event, uid, HUMAN_KIND, handoffCard(settings));
  }
  if (route.kind === "topic") {
    // 2 ต.ค. 69: เล่าเรื่องยาว (≥ STORY_MIN_CHARS) ที่มีคำหมวดกฎหมาย → การ์ดรับเรื่อง (ส่งเป็นเรื่องได้เลย) แทนการ์ดความรู้หมวด
    if (draft && route.story) return replyOncePerWindow(event, uid, FALLBACK_KIND, offerCardFor(uid, draft, settings));
    // การ์ดหมวดเดิมไม่ส่งซ้ำในหน้าต่างเวลา — คนเล่าเรื่องมรดกยาวๆ พิมพ์คำว่า "มรดก" หลายรอบได้การ์ดครั้งเดียว
    // raw_text ลง keyword_log เฉพาะครั้งที่ส่งการ์ดจริง (เดิมเก็บทุกข้อความที่แมตช์)
    return replyOncePerWindow(event, uid, route.topic.key, topicCard(route.topic, settings.responder_label), text.slice(0, 500));
  }
  // 2 ต.ค. 69: ข้อความทั่วไป/เล่าเรื่อง → การ์ดรับเรื่อง (เก็บเข้าร่างแล้ว) ครั้งเดียวต่อ 12 ชม. · ยังไม่มีตาราง = การ์ดเดิมชี้ไปฟอร์ม
  if (draft) return replyOncePerWindow(event, uid, FALLBACK_KIND, offerCardFor(uid, draft, settings));
  return replyOncePerWindow(event, uid, FALLBACK_KIND, chatReceivedCard(settings.responder_label));
}

/* ═══════════════ รับเรื่องทางแชต (2 ต.ค. 69 — มติบอส "เล่าอิสระ แล้วกดยืนยัน") ═══════════════
   ร่าง/CAS/กดซ้ำ/หมดอายุ อยู่ที่ api/_chatintake.js · การ์ดทุกใบอยู่ api/_cards.js · แจ้งเจ้าหน้าที่ api/_notify.js */

// รับเรื่องทางแชตเฉพาะแชต 1:1 กับ OA (มี userId) — ข้อความ/รูปในกลุ่มหรือห้องไม่เก็บเป็นร่างเรื่องของใคร
function intakeAllowed(event, uid) {
  return !!uid && event.source?.type === "user";
}

async function openCaseNoOf(uid) {
  const row = await latestOpenCaseOf(uid).catch(() => null);
  return row ? row.case_no : null;
}

// การ์ดรับเรื่อง (สร้างตอนผ่านตัวกั้นจริงเท่านั้น — หาเรื่องเดิมที่ยังเปิดเพื่อโชว์ปุ่ม "เพิ่มข้อมูลเข้าเรื่อง")
function offerCardFor(uid, draft, settings) {
  return async () => intakeOfferCard(summarizeDraft(draft), settings, { openCaseNo: await openCaseNoOf(uid) });
}

async function nudgePhone(event, uid, draft, settings) {
  if (!(await intake.claimPhoneNudge(uid).catch(() => false))) return; // เตือนไปแล้วใน 10 นาที — เงียบ (ข้อความเก็บเข้าร่างแล้ว)
  return replySafe(event.replyToken, intakePhoneCard(settings, { reminder: true, type: draft.pending_type }));
}

function unavailableReply(settings) {
  return errorCard(`ระบบขัดข้องชั่วคราวค่ะ ข้อความของท่านยังไม่หาย กรุณากดส่งอีกครั้งในอีกสักครู่ หรือโทร ${settings.phone}`);
}

/* ร่างว่าง/เพิ่งส่ง/กำลังส่ง → คำตอบที่เหมาะสม (null = ร่างพร้อมส่ง) */
function intakeNotReadyReply(d, settings, { forAppend = false } = {}) {
  if (d.inflight) return { type: "text", text: INTAKE_BUSY_TEXT };
  if (hasSubstance(d)) return null;
  if (!forAppend && d.submitted_at && d.last_case_no) return intakeAlreadySentCard(d.last_case_no);
  return intakeEmptyCard(settings, { forAppend });
}

async function handleIntakePostback(event, uid, rest, settings) {
  if (INTAKE_TYPES.includes(rest)) return intakeSubmit(event, uid, rest, settings);
  if (rest === "skipphone") return intakeSkipPhone(event, uid, settings);
  if (rest === "cancel") return intakeCancel(event, uid, settings);
  if (rest.startsWith("append:")) return intakeAppendToCase(event, uid, rest.slice("append:".length).toUpperCase(), settings);
  return replySafe(event.replyToken, mainMenuCard(settings));
}

/* lg:chatintake — ปุ่ม "💬 พิมพ์เล่าในแชตแทน" ในการ์ดหลักเกณฑ์ปรึกษา/ร้องเรียน
   ล้างตัวกั้นการ์ดรับเรื่องด้วย (ข้อความที่พิมพ์ตามมาต้องได้การ์ดที่มีปุ่มส่ง ไม่ใช่เงียบเพราะเคยได้การ์ดไปแล้วเมื่อเช้า) */
async function handleChatIntakeHowto(event, uid, settings) {
  const ctx = uid ? await intake.load(uid) : { ok: false };
  if (!ctx.ok) return replySafe(event.replyToken, chatReceivedCard(settings.responder_label)); // ยังไม่มีตาราง/DB ล่ม = ชี้ไปฟอร์มแบบเดิม
  await cardGate.reset(uid, FALLBACK_KIND);
  const summary = hasSubstance(ctx.draft) ? summarizeDraft(ctx.draft) : null;
  return replySafe(event.replyToken, intakeHowtoCard(settings, summary, { openCaseNo: summary ? await openCaseNoOf(uid) : null }));
}

/* lg:intake:<consult|complaint|appointment> — ส่งร่างเป็นเรื่องใหม่ (ไม่มีเบอร์ = ขอเบอร์ก่อน 1 ครั้ง) */
async function intakeSubmit(event, uid, type, settings) {
  const ctx = await intake.load(uid);
  if (!ctx.ok) {
    // ยังไม่รัน migration-14 (ปกติการ์ดนี้ไม่โผล่) → ทางฟอร์มของบริการนั้นแทน · DB ล่ม → แจ้งให้ลองใหม่
    return replySafe(event.replyToken, ctx.reason === "missing" ? simplePostbackReply("lg:" + type, settings) : unavailableReply(settings));
  }
  const d = ctx.draft;
  const notReady = intakeNotReadyReply(d, settings);
  if (notReady) {
    if (!d.inflight) await cardGate.reset(uid, FALLBACK_KIND); // ร่างว่าง → ข้อความถัดไปได้การ์ดที่มีปุ่มส่งอีกครั้ง
    return replySafe(event.replyToken, notReady);
  }
  if (type === "appointment" && !settings.appointment_enabled) {
    return replySafe(event.replyToken, [
      { type: "text", text: INTAKE_APPT_OFF_TEXT },
      intakeOfferCard(summarizeDraft(d), settings, { openCaseNo: await openCaseNoOf(uid) }),
    ]);
  }
  const textPhone = extractPhone(draftText(d.items));
  const phone = textPhone || d.phone;
  if (!phone) {
    await intake.setAwaitingPhone(uid, type);
    return replySafe(event.replyToken, intakePhoneCard(settings, { type }));
  }
  return finalizeIntake(event, uid, { type, phone, phoneFrom: textPhone ? "text" : "draft", settings });
}

/* lg:intake:skipphone / พิมพ์ "ไม่มีเบอร์" ระหว่างรอเบอร์ — ส่งแบบไม่มีเบอร์ (ติดต่อกลับผ่านแชตด้วยปุ่มแจ้งผลประชาชน) */
async function intakeSkipPhone(event, uid, settings) {
  const ctx = await intake.load(uid);
  if (!ctx.ok) return replySafe(event.replyToken, unavailableReply(settings));
  const d = ctx.draft;
  const notReady = intakeNotReadyReply(d, settings);
  if (notReady) return replySafe(event.replyToken, notReady);
  if (d.awaiting !== "phone" || !INTAKE_TYPES.includes(d.pending_type)) {
    // ปุ่มเก่าค้างในแชต (ไม่ได้อยู่ระหว่างรอเบอร์) → ให้เลือกประเภทเรื่องใหม่จากการ์ดรับเรื่อง
    return replySafe(event.replyToken, intakeOfferCard(summarizeDraft(d), settings, { openCaseNo: await openCaseNoOf(uid) }));
  }
  return finalizeIntake(event, uid, { type: d.pending_type, phone: null, phoneFrom: null, settings });
}

/* พิมพ์เบอร์ระหว่างรอเบอร์ — ข้อความที่มีอย่างอื่นปน (เช่น ชื่อ) เก็บเข้าร่างก่อน แล้วส่งเรื่องด้วยเบอร์นั้น */
async function intakeTypedPhone(event, uid, text, phone, draft, settings) {
  if (!isPhoneOnly(text)) await intake.append(uid, [{ t: "text", text }]);
  const type = INTAKE_TYPES.includes(draft?.pending_type) ? draft.pending_type : "consult";
  return finalizeIntake(event, uid, { type, phone, phoneFrom: "typed", settings });
}

/* สร้างเรื่องจากร่าง — claimSubmit (atomic กันกดซ้ำ/สองอินสแตนซ์) → createCase → ล้างร่าง → ตอบ caseConfirmCard (reply)
   → แจ้งเจ้าหน้าที่ · createCase พัง = คืนร่าง (release) ไม่มีอะไรหาย + บอกผู้ใช้ให้กดใหม่ */
async function finalizeIntake(event, uid, { type, phone, phoneFrom, settings }) {
  const claim = await intake.claimSubmit(uid, { mode: "new", type, phone });
  if (claim.status === "busy") return replySafe(event.replyToken, { type: "text", text: INTAKE_BUSY_TEXT });
  if (claim.status === "already") return replySafe(event.replyToken, intakeAlreadySentCard(claim.caseNo));
  if (claim.status !== "claimed") return replySafe(event.replyToken, intakeEmptyCard(settings));
  const fl = claim.claimed;
  const caseType = INTAKE_TYPES.includes(fl.type) ? fl.type : "consult";
  // ชื่อจากโปรไฟล์ไลน์ (timeout สั้น — ดึงไม่ทันก็ส่งเรื่องต่อแบบไม่มีชื่อ) · ชื่อผู้ใช้ตั้งเองได้ทุกอย่าง → cleanDisplayName เสมอ
  const profile = await getProfile(uid, { timeout: 2500, retries: 0 });
  const name = cleanDisplayName(profile?.displayName);
  const draftLike = { items: fl.items || [], evidence_paths: fl.evidence_paths || [] };
  let caseRow;
  try {
    caseRow = await createCase({
      caseType,
      category: guessCategory(draftText(draftLike.items)),
      citizenName: name,
      citizenPhone: phone || null,
      citizenLineUid: uid,
      isAnonymous: false,
      detail: buildCaseDetail(draftLike, { displayName: name, phone, phoneFrom }),
      evidencePaths: draftLike.evidence_paths,
      pdpaConsent: true,
      source: "chat",
      submissionId: fl.submission_id,
    });
  } catch (e) {
    console.error("intake: สร้างเรื่องจากแชตไม่สำเร็จ — คืนร่างให้กดส่งใหม่", e?.message || e);
    await intake.release(uid).catch((err) => console.error("intake: คืนร่างไม่สำเร็จ (ร่างจะถูกกู้อัตโนมัติภายหลัง)", err?.message || err));
    return replySafe(event.replyToken, unavailableReply(settings));
  }
  // เรื่องเกิดแล้ว — ล้างร่าง (ไฟล์เป็นของเรื่องแล้ว) · ล้างไม่สำเร็จ ร่างค้าง inflight จะถูกกู้เป็น "ส่งแล้ว" เองภายหลัง (recoverInflight)
  await intake.complete(uid, { caseNo: caseRow.case_no, phone }).catch((e) => console.error("intake: ล้างร่างหลังส่งไม่สำเร็จ", e?.message || e));
  await cardGate.reset(uid, FALLBACK_KIND); // ข้อความถัดไปได้การ์ดรับเรื่องอีกครั้ง (มีปุ่มเพิ่มข้อมูลเข้าเรื่องนี้)
  await replySafe(event.replyToken, caseConfirmCard(caseRow, settings.responder_label));
  // ⚠️ await ก่อนจบ handler เสมอ (Vercel อาจตัดงานที่ค้างหลังตอบ 200)
  await notifyStaff(caseRow).catch((e) => console.error("notifyStaff failed", e));
}

/* lg:intake:cancel — ล้างร่าง + ลบไฟล์ของร่าง (ไฟล์ที่อยู่ในเรื่องแล้วไม่ถูกแตะ — ดู safeDeleteFiles) */
async function intakeCancel(event, uid, settings) {
  let r;
  try {
    r = await intake.cancel(uid);
  } catch (e) {
    console.error("intake: ยกเลิกร่างไม่สำเร็จ", e?.code || e?.message || e);
    return replySafe(event.replyToken, unavailableReply(settings));
  }
  if (r.busy) return replySafe(event.replyToken, { type: "text", text: INTAKE_BUSY_TEXT });
  await cardGate.reset(uid, FALLBACK_KIND);
  return replySafe(event.replyToken, { type: "text", text: INTAKE_CANCELLED_TEXT });
}

/* lg:intake:append:<caseNo> — เพิ่มข้อความ/ไฟล์ในร่างเข้าเรื่องเดิมที่ยังเปิดอยู่ (ตรวจเจ้าของเรื่องแบบ handleStatusLookup เสมอ)
   ข้อความ+ไฟล์บันทึกใน transaction เดียวผ่าน RPC และใช้ submission_id กัน retry ซ้ำ */
async function intakeAppendToCase(event, uid, caseNo, settings) {
  const row = await getCaseByNo(caseNo).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, statusNotFoundCard());
  if (!OPEN_STATUSES.includes(row.status)) {
    const ctx = await intake.load(uid);
    return replySafe(event.replyToken, [
      { type: "text", text: `เรื่อง ${caseNo} ปิดหรือยกเลิกแล้ว จึงเพิ่มข้อมูลไม่ได้ค่ะ หากต้องการ ส่งเป็นเรื่องใหม่ได้จากการ์ดด้านล่างค่ะ` },
      ...(ctx.ok && hasSubstance(ctx.draft) ? [intakeOfferCard(summarizeDraft(ctx.draft), settings)] : []),
    ]);
  }
  const claim = await intake.claimSubmit(uid, { mode: "append", caseNo });
  if (claim.status === "busy") return replySafe(event.replyToken, { type: "text", text: INTAKE_BUSY_TEXT });
  if (claim.status !== "claimed") {
    await cardGate.reset(uid, FALLBACK_KIND);
    return replySafe(event.replyToken, intakeEmptyCard(settings, { forAppend: true }));
  }
  const fl = claim.claimed;
  const items = fl.items || [];
  const existing = row.evidence_paths || [];
  const files = (fl.evidence_paths || []).filter((p) => !existing.includes(p));
  const room = Math.max(0, MAX_TOTAL_EVIDENCE - existing.length);
  let keep = files.slice(0, room);
  let drop = files.slice(room);
  const textCount = items.filter((i) => i.t === "text" || i.t === "location").length;
  let updated = row;
  try {
    updated = await appendChatSubmission(
      row.id,
      buildAppendNote(items, { filesAdded: keep.length, filesDropped: drop.length }),
      keep,
      fl.submission_id,
    );
    // RPC ล็อกแถวและบังคับเพดานอีกชั้น หากมีคำขออื่นเพิ่มไฟล์ตัดหน้าหลังเราอ่าน row ให้ยึดผลจริงจาก transaction
    const actual = new Set(updated.evidence_paths || []);
    keep = files.filter((p) => actual.has(p));
    drop = files.filter((p) => !actual.has(p));
  } catch (e) {
    console.error("intake: เพิ่มข้อมูลเข้าเรื่องไม่สำเร็จ — คืนร่าง", e?.message || e);
    await intake.release(uid).catch((err) => console.error("intake: คืนร่างไม่สำเร็จ", err?.message || err));
    return replySafe(event.replyToken, unavailableReply(settings));
  }
  await intake.complete(uid, { caseNo }).catch((e) => console.error("intake: ล้างร่างหลังเพิ่มข้อมูลไม่สำเร็จ", e?.message || e));
  if (drop.length) await intake.safeDeleteFiles(uid, drop); // เกินเพดานเรื่อง — ไม่อยู่ในเรื่อง ลบทิ้งไม่ให้ค้าง
  await cardGate.reset(uid, FALLBACK_KIND);
  await replySafe(event.replyToken, intakeAppendedCard(caseNo, { texts: textCount, files: keep.length, dropped: drop.length }, settings));
  const what = [textCount ? `ข้อความ ${textCount} รายการ` : null, keep.length ? `ไฟล์ ${keep.length} ไฟล์` : null].filter(Boolean).join(" · ");
  await notifyCaseUpdate(updated, `💬 ผู้แจ้งเพิ่มข้อมูลทางแชตในเรื่อง ${caseNo}${what ? ` (${what})` : ""} ดูได้ที่หน้าเว็บหลังบ้าน`)
    .catch((e) => console.error("notifyCaseUpdate failed", e));
}

/* ═══ รูป/ไฟล์/พิกัด/วิดีโอ/เสียงที่ส่งเข้าแชต (2 ต.ค. 69) ═══
   รูป/PDF → โหลดจากไลน์ ตรวจหัวไฟล์ อัปโหลด bucket evidence แล้วเข้าร่าง (เงียบ) · ชนิดอื่น/ใหญ่เกิน/โหลดไม่ได้ → โน้ตถึงเจ้าหน้าที่
   + บอกผู้ใช้สั้นๆ ครั้งเดียว (FILE_NOTE_KIND) · วิดีโอ/เสียงไม่เก็บไฟล์ · พิกัด = ข้อความ + ลิงก์แผนที่
   ตอบการ์ดรับเรื่องผ่านตัวกั้นเดียวกับข้อความพิมพ์ (FALLBACK_KIND) — รูปหลายใบติดกันได้การ์ดใบเดียว */
async function handleMedia(event, uid, deadline) {
  const msg = event.message || {};
  const settings = await getSettings();
  const ctx = intakeAllowed(event, uid) ? await intake.load(uid) : { ok: false };
  const legacy = () => replyOncePerWindow(event, uid, FALLBACK_KIND, chatReceivedCard(settings.responder_label));
  if (!ctx.ok) return legacy(); // ยังไม่รัน migration-14 / DB ล่ม = แบบเดิม (ไม่เก็บไฟล์)

  const items = [];
  let notice = null;
  if (msg.type === "image" || msg.type === "file") {
    if ((ctx.draft.evidence_paths || []).length >= MAX_DRAFT_FILES) {
      items.push({ t: "note", text: `ผู้แจ้งส่งไฟล์เพิ่ม แต่ร่างมีไฟล์ครบ ${MAX_DRAFT_FILES} ไฟล์แล้ว — ระบบไม่ได้บันทึก` });
      notice = "full";
    } else {
      const got = await ingestLineMedia(uid, msg, { deadline });
      if (got.item) items.push(got.item);
      else { items.push({ t: "note", text: got.note }); notice = got.userReason; }
    }
  } else if (msg.type === "video" || msg.type === "audio") {
    items.push({ t: "note", text: `ผู้แจ้งส่ง${msg.type === "video" ? "วิดีโอ" : "ข้อความเสียง"} — ระบบไม่ได้บันทึกไฟล์` });
    notice = "type";
  } else if (msg.type === "location") {
    items.push({ t: "location", text: locationItemText(msg) });
  } else {
    return legacy();
  }

  let res;
  try {
    res = await intake.append(uid, items);
  } catch (e) {
    // เก็บเข้าร่างไม่ได้ → ไฟล์ที่เพิ่งอัปโหลดต้องไม่ค้างลอยใน bucket
    const uploaded = items.filter((i) => i.t === "file").map((i) => i.path);
    if (uploaded.length) await intake.safeDeleteFiles(uid, uploaded);
    throw e;
  }
  for (const rj of res.rejected) {
    if (rj.item.t === "file") { await intake.safeDeleteFiles(uid, [rj.item.path]); notice = notice || "full"; }
  }
  const draft = res.draft;
  const entries = [];
  if (notice) entries.push({ kind: FILE_NOTE_KIND, card: intakeFileNoticeText(notice) });
  if (draft.awaiting === "phone") {
    if (await intake.claimPhoneNudge(uid).catch(() => false)) entries.push({ card: intakePhoneCard(settings, { reminder: true, type: draft.pending_type }) });
  } else if (hasSubstance(draft)) {
    entries.push({ kind: FALLBACK_KIND, card: offerCardFor(uid, draft, settings) });
  }
  if (entries.length) return replyGated(event, uid, entries);
}

/* ให้คะแนนความพึงพอใจ (แนวคิดจาก Traffy Fondue) — ตรวจสิทธิ์แบบเดียวกับ handleStatusLookup เสมอ
   (citizen_line_uid ต้องตรงกับ uid ที่กดปุ่มจริง กันคนอื่นกดลิงก์/ปุ่มให้คะแนนแทนเจ้าของเรื่อง) */
async function handleSatisfactionRate(event, uid, caseId, score) {
  if (!Number.isInteger(caseId) || score < 1 || score > 5) return replySafe(event.replyToken, errorCard());
  const row = await getCaseById(caseId).catch(() => null);
  if (!row || row.citizen_line_uid !== uid) return replySafe(event.replyToken, errorCard("ไม่พบเรื่องนี้ หรือไม่มีสิทธิ์ให้คะแนน"));
  if (row.satisfaction_rating) return replySafe(event.replyToken, { type: "text", text: "ท่านให้คะแนนเรื่องนี้ไปแล้ว ขอบคุณค่ะ" });
  await recordSatisfaction(caseId, score);
  return replySafe(event.replyToken, { type: "text", text: `ขอบคุณสำหรับคะแนน ${"⭐".repeat(score)} ค่ะ` });
}

/* ═══ เชื่อมบัญชี LINE แบบไม่บังคับ (เพิ่ม 17 ก.ย. 69 รอบ 3) — เจ้าหน้าที่กด "สร้างรหัสเชื่อมบัญชี" ในหน้า
   staff.html (action=link-line-code) แล้วพิมพ์ #เชื่อม <รหัส> ในแชตนี้ภายใน 10 นาที เพื่อรับแจ้งเตือน
   เรื่องใหม่/เร่งด่วนผ่าน LINE push เสริมจากอีเมล ไม่ใช่ตัวยืนยันตัวตนสำหรับเข้าหลังบ้านอีกต่อไป ═══ */
async function handleLinkLineCommand(event, uid, code) {
  if (!code) return replySafe(event.replyToken, { type: "text", text: "รูปแบบ: #เชื่อม <รหัส> (ดูรหัสจากหน้าเว็บหลังบ้าน)" });
  const { data: row } = await db().from("staff_link_codes").select("*").eq("code", code.toUpperCase()).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return replySafe(event.replyToken, { type: "text", text: "รหัสไม่ถูกต้องหรือหมดอายุแล้ว กรุณาสร้างรหัสใหม่จากหน้าเว็บหลังบ้าน" });
  }
  await db().from("staff").update({ line_uid: uid }).eq("id", row.staff_id);
  await db().from("staff_link_codes").delete().eq("code", row.code);
  return replySafe(event.replyToken, { type: "text", text: "เชื่อมบัญชี LINE สำเร็จแล้ว ท่านจะได้รับแจ้งเตือนเรื่องใหม่/เร่งด่วนผ่านทางนี้เพิ่มเติมจากอีเมล" });
}
