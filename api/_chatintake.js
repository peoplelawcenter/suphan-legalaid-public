/* api/_chatintake.js — "รับเรื่องทางแชต" (2 ต.ค. 69)

   บอสแจ้ง "เจ้าหน้าที่ไม่เห็นการจองคิวทนายอาสา หรือเรื่องร้องเรียนร้องทุกข์" — ต้นเหตุจริง: ประชาชนพิมพ์เล่าเรื่องในแชตไลน์
   (ไม่ได้กรอกฟอร์ม) แต่ข้อความแชตไม่เคยเข้าหลังบ้าน (เดิมได้การ์ด chatReceivedCard ชี้ไปฟอร์มแล้วเงียบ 12 ชม.)
   บอสสั่ง "เวลาประชาชนพิมพ์ text มาให้รับเรื่องได้ด้วย ไม่จำเป็นต้องกรอกแบบฟอร์มอย่างเดียว"
   มติบอส (2 ต.ค. 69): "เล่าอิสระ แล้วกดยืนยัน" — พิมพ์กี่ข้อความ/แนบรูป-PDF กี่ไฟล์ก็ได้ บอทรวบเป็น "ร่าง" (ตาราง chat_drafts
   1 แถว/คน) → การ์ดให้กดส่ง → ไม่มีเบอร์ในข้อความ บอทขอเบอร์ 1 ครั้ง (ข้ามได้) → ได้เลขที่เรื่อง + แจ้งเจ้าหน้าที่
   ⛔ ทักทาย/ขอบคุณ/สติกเกอร์ไม่เข้าร่าง (ตัดสินที่ routeText ใน _chatgate.js) · ห้ามส่งข้อความประชาชนไป AI (กฎศูนย์นี้)
   ⛔ ห้าม console.log ข้อความ/ชื่อ/เบอร์ที่ประชาชนพิมพ์ (PDPA)

   โครงไฟล์:
   1) ฟังก์ชันบริสุทธิ์ (ทดสอบออฟไลน์ได้ — scripts/test-chatintake.mjs): extractPhone · guessCategory · buildCaseDetail ·
      hasSubstance · addItems (เพดาน) · summarizeDraft
   2) store (แยกให้ทดสอบได้แบบ createCardGate/keywordLogStore ใน _chatgate.js) — ของจริง chatDraftStore = Supabase
   3) createChatIntake(store) — ทุกการแก้ร่างเป็น compare-and-swap ด้วยคอลัมน์ rev (ข้อความ/รูปหลายชิ้นเข้ามาพร้อมกัน
      คนละอินสแตนซ์ต้องไม่ทับกันหาย) · claimSubmit atomic (update … where submitted_at is null and rev = ?) กันกดซ้ำได้ 2 เรื่อง
      · ตอนกดส่ง ย้ายรายการ+ไฟล์ออกจากร่างไปไว้ inflight ทันที (ไฟล์ที่กำลังเข้าเรื่องจะไม่ถูกตัวลบร่างหมดอายุแตะ)
   4) ไฟล์จากไลน์ ingestLineMedia() — โหลด → ตรวจหัวไฟล์ → อัปโหลด bucket evidence (private) "<uid>/chat/…"

   ยังไม่รัน supabase-migration-14-chat-intake.sql → load() คืน { ok:false } แล้ว line-webhook.js ถอยไปพฤติกรรมเดิม */
import { db } from "./_db.js";
import { matchTopic } from "./_keywords.js";
import { CATEGORY_OPTIONS, normalizePhone } from "./_appointment.js";
import { isMissingTableError, MAX_TOTAL_EVIDENCE } from "./_cases.js";
import { deleteEvidence, evidenceTypeOf, chatEvidencePath, storeEvidenceBuffer, MAX_FILE_BYTES } from "./_evidence.js";
import { getMessageContent } from "./_lineapi.js";
import { randomUUID } from "node:crypto";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // ร่างที่ยังไม่ส่ง หมดอายุ 24 ชม. หลังแก้ล่าสุด (ลบพร้อมไฟล์)
export const SUBMITTED_KEEP_MS = 2 * 24 * 60 * 60 * 1000; // แถวที่ส่งแล้ว (ใช้ตอบ "ส่งแล้ว เลขที่…") เก็บ 2 วัน
export const STALE_INFLIGHT_MS = 2 * 60 * 1000; // กดส่งแล้วค้างเกินนี้ = อินสแตนซ์ตายกลางทาง (webhook มีเวลาแค่ 30 วิ) → กู้คืน
export const PHONE_NUDGE_MS = 10 * 60 * 1000; // ระหว่างรอเบอร์ เตือนซ้ำไม่เกิน 1 ครั้ง/10 นาที
export const MAX_DRAFT_CHARS = 4000;
export const MAX_DRAFT_ITEMS = 40;
export const MAX_DRAFT_FILES = 10; // ต่อร่าง — ตอนเพิ่มเข้าเรื่องเดิมรวมไม่เกิน MAX_TOTAL_EVIDENCE (12) ของ _cases.js
export const MAX_CHAT_FILE_BYTES = MAX_FILE_BYTES; // 8MB = file_size_limit ของ bucket evidence (ใหญ่กว่านี้ Storage ปฏิเสธเอง)
export const INTAKE_TYPES = ["consult", "complaint", "appointment"];
export { MAX_TOTAL_EVIDENCE };

/* ═══════════════ 1) ฟังก์ชันบริสุทธิ์ ═══════════════ */

/* เบอร์โทรไทยในข้อความ — มือถือ 0[689]+8 หลัก · บ้าน 0[2-7]+7 หลัก · ยอมเว้นวรรค/ขีด/จุดคั่น · +66 · เลขไทย ๐–๙
   คืนตัวเลขล้วน (ผ่าน normalizePhone ของแบบคำร้อง — สูตรเดียวกับฟอร์มเว็บ) หรือ null
   ไม่นับเลขที่ติดกับตัวเลขอื่น (เลขบัตร 13 หลัก/เลขบัญชี/รหัสไปรษณีย์) และข้ามเลขที่ข้างหน้าบอกว่าเป็นบัญชี/พร้อมเพย์/
   เบอร์ของคนร้าย (เรื่องถูกโกงมักมีเลขพวกนี้ — เอาไปเป็นเบอร์ติดต่อกลับผิดคนอันตรายกว่าถามซ้ำ) · เจอหลายเบอร์ใช้เบอร์สุดท้าย
   (คนมักลงท้ายด้วย "ติดต่อกลับเบอร์ …") */
const PHONE_RE = /(?<!\d[\s.-]?)(?:\+66[\s.-]?|0)(?:[689](?:[\s.-]?\d){8}|[2-7](?:[\s.-]?\d){7})(?![\s.-]?\d)/g;
const NOT_MY_PHONE_RE = /(บัญชี|บ\/ช|บช\.?|ธนาคาร|พร้อมเพย์|พร้อมเพ|promptpay|account|acc\.?|โทรมา(จาก)?(เบอร์)?|มิจฉาชีพ|คนร้าย|ผู้ร้าย|แก๊ง|คู่กรณี|ผู้ถูกร้อง|เบอร์(ของ)?(เขา|มัน|คนร้าย|มิจฉาชีพ))[^\d]{0,12}$/i;
function toAsciiDigits(s) {
  return String(s || "").replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));
}
export function extractPhone(text) {
  const s = toAsciiDigits(text);
  let found = null;
  for (const m of s.matchAll(PHONE_RE)) {
    const before = s.slice(Math.max(0, m.index - 30), m.index);
    if (NOT_MY_PHONE_RE.test(before)) continue;
    const p = normalizePhone(m[0].replace(/\s+/g, ""));
    if (p) found = p;
  }
  return found;
}

/* ข้อความที่มีแค่เบอร์ (+คำประกอบอย่าง "เบอร์/โทร/ครับ/ค่ะ") — พิมพ์ตอบตอนระบบขอเบอร์ ไม่ต้องเก็บซ้ำเป็นข้อความในเรื่อง
   (มีอย่างอื่นปน เช่น ชื่อ-นามสกุล → เก็บเข้าร่างด้วย) */
const PHONE_FILLER_RE = /เบอร์|โทรศัพท์|โทร|มือถือ|ติดต่อกลับ|ติดต่อ|หมายเลข|ได้ที่|ที่|ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|นะ|ผม|ดิฉัน|ฉัน|หนู|ของ|คือ|เลย|tel|phone|mobile/gi;
export function isPhoneOnly(text) {
  const s = toAsciiDigits(text).replace(/[\d\s+().\-:,/]/g, "").replace(PHONE_FILLER_RE, "").replace(/[\p{P}\p{S}]/gu, "");
  return s.length === 0;
}

/* ข้อความระหว่างรอเบอร์ที่แปลว่า "ไม่ให้เบอร์" (สั้นๆ เท่านั้น) — เทียบเท่ากดปุ่ม "ข้ามขั้นตอนนี้" */
const PHONE_SKIP_RE = /^(ไม่มี(เบอร์)?|ไม่สะดวก(ให้เบอร์)?|ไม่ให้(เบอร์)?|ข้าม|ข้ามไป|ไม่ขอให้เบอร์|skip)(ครับ|คับ|ค่ะ|คะ|ค่า|จ้า|นะ|ๆ|\s)*$/i;
export function isPhoneSkip(text) {
  const t = String(text || "").trim();
  return [...t].length <= 30 && PHONE_SKIP_RE.test(t);
}

/* หมวดของเรื่อง (คีย์ชุดเดียวกับ CATEGORY_OPTIONS / recategorize) — ใช้ matchTopic ของพจนานุกรมหมวดกฎหมายก่อน
   แล้วเติม 2 หมวดที่พจนานุกรมไม่มี (ที่ดิน/คดีอาญา) ด้วยคำกว้างๆ — เป็นแค่ "เดาหมวด" เจ้าหน้าที่แก้ได้จากหลังบ้านเสมอ */
const CATEGORY_KEYS = CATEGORY_OPTIONS.map((c) => c.value);
const EXTRA_CATEGORY_PATTERNS = [
  { key: "land", re: /ที่ดิน|โฉนด|น\.ส\.\s?3|รุกล้ำ|แนวเขต|บ้านเช่า|เช่าบ้าน|ผู้เช่า|ค่าเช่า/ },
  { key: "criminal", re: /อุบัติเหตุ|รถชน|ชนท้าย|ลักทรัพย์|ถูกขโมย|ขโมย|แจ้งความ|ทำร้ายร่างกาย|ถูกทำร้าย|หมิ่นประมาท|ยาเสพติด|คดีอาญา/ },
];
export function guessCategory(text) {
  const s = String(text || "");
  const topic = matchTopic(s);
  if (topic && CATEGORY_KEYS.includes(topic.key)) return topic.key;
  const extra = EXTRA_CATEGORY_PATTERNS.find((p) => p.re.test(s));
  return extra ? extra.key : "other";
}

export function emptyDraft(uid) {
  return {
    line_uid: uid, items: [], evidence_paths: [], inflight: null, rev: 0, awaiting: null, pending_type: null,
    phone: null, last_case_no: null, submitted_at: null, phone_nudged_at: null, created_at: null, updated_at: null, exists: false,
  };
}
export function normalizeDraft(row, uid) {
  if (!row) return emptyDraft(uid);
  return {
    ...emptyDraft(uid),
    ...row,
    items: Array.isArray(row.items) ? row.items : [],
    evidence_paths: Array.isArray(row.evidence_paths) ? row.evidence_paths : [],
    inflight: row.inflight && typeof row.inflight === "object" ? row.inflight : null,
    rev: Number.isInteger(Number(row.rev)) ? Number(row.rev) : 0,
    exists: true,
  };
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const textItems = (items) => items.filter((i) => i.t === "text");
const charsOf = (items) => textItems(items).reduce((n, i) => n + String(i.text || "").length, 0);

export function hasSubstance(d) {
  return (d.items || []).some((i) => i.t === "text" || i.t === "file" || i.t === "location") || (d.evidence_paths || []).length > 0;
}
/* ร่างที่ยังไม่ส่งและไม่มีใครแตะเกิน 24 ชม. (ร่างที่กำลังส่ง inflight ไม่นับ — ไฟล์อาจกำลังเข้าเรื่อง) */
export function isDraftExpired(d, now = Date.now()) {
  if (d.inflight) return false;
  if (!(d.items || []).length && !(d.evidence_paths || []).length) return false;
  const t = ms(d.updated_at);
  return Number.isFinite(t) && now - t > DRAFT_TTL_MS;
}
export function draftText(items) {
  return textItems(items || []).map((i) => i.text).join("\n");
}

/* สรุปร่างสำหรับการ์ด — ตัวอย่างต้นข้อความสั้นๆ บรรทัดเดียว (เป็นข้อความของผู้ใช้เองในแชตของเขาเอง) */
export function summarizeDraft(d) {
  const items = d.items || [];
  const firstText = textItems(items)[0]?.text || "";
  const oneLine = String(firstText).replace(/\s+/g, " ").trim();
  return {
    texts: textItems(items).length,
    files: (d.evidence_paths || []).length,
    locations: items.filter((i) => i.t === "location").length,
    preview: oneLine.length > 60 ? oneLine.slice(0, 59) + "…" : oneLine,
  };
}

/* เพิ่มรายการเข้าร่างตามเพดาน — คืน { draft, added, rejected:[{item, reason}] }
   reason: "items" (ครบ 40 รายการ) · "chars" (ข้อความรวมครบ 4,000 ตัว) · "files" (ไฟล์ครบ 10)
   ข้อความยาวเกินที่เหลือ → ตัดให้พอดีแล้วเติมโน้ตให้เจ้าหน้าที่ 1 ครั้ง (ไม่ทิ้งทั้งข้อความ) */
const TRUNC_NOTE = `ข้อความยาวเกิน ${MAX_DRAFT_CHARS.toLocaleString("en-US")} ตัวอักษร ระบบตัดส่วนเกินออก`;
export function addItems(d, newItems, now = Date.now()) {
  const at = new Date(now).toISOString();
  const items = [...(d.items || [])];
  const paths = [...(d.evidence_paths || [])];
  const rejected = [];
  let added = 0;
  for (const raw of newItems || []) {
    const item = { ...raw, at: raw.at || at };
    if (items.length >= MAX_DRAFT_ITEMS) { rejected.push({ item, reason: "items" }); continue; }
    if (item.t === "file") {
      if (!item.path || paths.length >= MAX_DRAFT_FILES) { rejected.push({ item, reason: "files" }); continue; }
      paths.push(item.path);
    }
    if (item.t === "text") {
      const left = MAX_DRAFT_CHARS - charsOf(items);
      const text = String(item.text || "");
      if (left <= 0) { rejected.push({ item, reason: "chars" }); continue; }
      if (text.length > left) {
        item.text = text.slice(0, left);
        items.push(item);
        added++;
        if (!items.some((i) => i.t === "note" && i.text === TRUNC_NOTE) && items.length < MAX_DRAFT_ITEMS) items.push({ t: "note", at, text: TRUNC_NOTE });
        continue;
      }
    }
    items.push(item);
    added++;
  }
  return { draft: { ...d, items, evidence_paths: paths }, added, rejected };
}

/* เวลาไทย "02/10 14:05" (24 ชม.) */
const BKK_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function bkkStamp(iso) {
  const t = ms(iso);
  if (!Number.isFinite(t)) return "--/-- --:--";
  const p = Object.fromEntries(BKK_FMT.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

function itemLines(items) {
  let fileNo = 0;
  return items.map((i) => {
    const stamp = `[${bkkStamp(i.at)}]`;
    if (i.t === "text") return `${stamp} ${i.text}`;
    if (i.t === "file") {
      fileNo++;
      return i.kind === "pdf"
        ? `${stamp} 📎 แนบไฟล์ PDF${i.name ? ` "${i.name}"` : ""} (ไฟล์ที่ ${fileNo})`
        : `${stamp} 📎 แนบรูปภาพ (ไฟล์ที่ ${fileNo})`;
    }
    if (i.t === "location") return `${stamp} ${i.text}`;
    return `${stamp} ⚠️ ${i.text}`; // note — หมายเหตุจากระบบถึงเจ้าหน้าที่
  });
}

/* รายละเอียดเรื่อง (cases.detail) จากร่าง — ข้อความเรียงเวลา + บรรทัดสรุปไฟล์/พิกัด/โน้ต + ที่มาของชื่อ/เบอร์
   opts: { displayName, phone, phoneFrom: "text"|"typed"|"draft"|null } */
export function buildCaseDetail(d, opts = {}) {
  const items = d.items || [];
  const s = summarizeDraft(d);
  const notes = items.filter((i) => i.t === "note").length;
  const lines = ["ข้อความที่ผู้แจ้งพิมพ์ในแชตไลน์ (เรียงตามเวลา):", ...itemLines(items), ""];
  const parts = [`ข้อความ ${s.texts}`, `ไฟล์แนบ ${s.files}${s.files ? " (ดูที่ \"หลักฐานแนบ\")" : ""}`];
  if (s.locations) parts.push(`พิกัด ${s.locations}`);
  if (notes) parts.push(`หมายเหตุระบบ ${notes}`);
  lines.push(`— สรุป: ${parts.join(" · ")}`);
  lines.push(opts.displayName
    ? `— ชื่อผู้แจ้ง "${opts.displayName}" มาจากชื่อโปรไฟล์ไลน์ (ยังไม่ได้ยืนยันตัวตน)`
    : "— ไม่ทราบชื่อผู้แจ้ง (ดึงชื่อโปรไฟล์ไลน์ไม่ได้)");
  lines.push(opts.phone
    ? `— เบอร์ติดต่อกลับ ${opts.phone} (${opts.phoneFrom === "typed" ? "ผู้แจ้งพิมพ์ตอนระบบขอเบอร์" : "พบในข้อความที่ผู้แจ้งพิมพ์"})`
    : "— ผู้แจ้งไม่ได้ให้เบอร์โทร — ติดต่อกลับผ่านปุ่ม \"แจ้งผลประชาชน\" ในหลังบ้าน (ส่งเข้าแชตไลน์ของผู้แจ้ง)");
  return lines.join("\n");
}

/* บันทึกไทม์ไลน์ตอนเพิ่มข้อมูลเข้าเรื่องเดิม (case_events.note) */
export function buildAppendNote(items, { filesAdded = 0, filesDropped = 0 } = {}) {
  const lines = itemLines(items.filter((i) => i.t !== "file"));
  if (filesAdded) lines.push(`📎 แนบไฟล์เพิ่ม ${filesAdded} ไฟล์ (ดูที่ "หลักฐานแนบ")`);
  if (filesDropped) lines.push(`⚠️ ไฟล์อีก ${filesDropped} ไฟล์ไม่ได้บันทึก (เรื่องนี้มีไฟล์ครบ ${MAX_TOTAL_EVIDENCE} ไฟล์แล้ว)`);
  return lines.join("\n") || "(ไม่มีข้อความ)";
}

/* ═══════════════ 2) store ของจริง (Supabase) ═══════════════
   ทุกฟังก์ชัน throw error ของ PostgREST ต่อ — createChatIntake แยกเองว่า "ยังไม่รัน migration" หรือ "DB ล่ม" */
const DRAFT_COLS = "line_uid,items,evidence_paths,inflight,rev,awaiting,pending_type,phone,last_case_no,submitted_at,phone_nudged_at,created_at,updated_at";
export const chatDraftStore = {
  async get(uid) {
    const { data, error } = await db().from("chat_drafts").select(DRAFT_COLS).eq("line_uid", uid).maybeSingle();
    if (error) throw error;
    return data;
  },
  // คืน null ถ้ามีแถวของคนนี้อยู่แล้ว (อีกอินสแตนซ์สร้างตัดหน้า) — ผู้เรียกอ่านใหม่แล้วลองอีกรอบ
  async insert(row) {
    const { data, error } = await db().from("chat_drafts").insert(row).select(DRAFT_COLS);
    if (error) {
      if (error.code === "23505" || /duplicate key/i.test(String(error.message || ""))) return null;
      throw error;
    }
    return data && data[0] ? data[0] : null;
  },
  // compare-and-swap: แก้ได้เฉพาะเมื่อ rev ยังเท่าเดิม — คืนแถวใหม่ หรือ null ถ้ามีคนแก้ตัดหน้า
  async update(uid, rev, patch) {
    const { data, error } = await db().from("chat_drafts").update(patch).eq("line_uid", uid).eq("rev", rev).select(DRAFT_COLS);
    if (error) throw error;
    return data && data[0] ? data[0] : null;
  },
  // กดส่ง (atomic): update … where line_uid=? and submitted_at is null and inflight is null and rev=? returning
  async claimSubmit(uid, rev, patch) {
    const { data, error } = await db().from("chat_drafts").update(patch)
      .eq("line_uid", uid).eq("rev", rev).is("submitted_at", null).is("inflight", null).select(DRAFT_COLS);
    if (error) throw error;
    return data && data[0] ? data[0] : null;
  },
  async remove(uid, rev) {
    const { data, error } = await db().from("chat_drafts").delete().eq("line_uid", uid).eq("rev", rev).select("line_uid");
    if (error) throw error;
    return !!(data && data.length);
  },
  async listOlderThan(iso, limit = 200) {
    const { data, error } = await db().from("chat_drafts").select(DRAFT_COLS).lt("updated_at", iso).order("updated_at").limit(limit);
    if (error) throw error;
    return data || [];
  },
  // กู้ผลลัพธ์ด้วยรหัสส่งที่ไม่ซ้ำเท่านั้น — ห้ามเดาจาก uid/เวลา เพราะอาจไปจับเรื่องจากฟอร์มคนละรายการ
  async submissionResult(submissionId, mode) {
    if (!submissionId) return null;
    if (mode === "append") {
      const { data: ev, error: evErr } = await db().from("case_events").select("case_id")
        .eq("idempotency_key", submissionId).eq("action", "citizen_message").maybeSingle();
      if (evErr) throw evErr;
      if (!ev?.case_id) return null;
      const { data, error } = await db().from("cases").select("case_no,created_at").eq("id", ev.case_id).maybeSingle();
      if (error) throw error;
      return data || null;
    }
    const { data, error } = await db().from("cases").select("case_no,created_at")
      .eq("submission_id", submissionId).maybeSingle();
    if (error) throw error;
    return data || null;
  },
  // path ไหนบ้างที่ถูกอ้างอยู่ในเรื่องแล้ว (cases.evidence_paths && {paths}) — ห้ามลบเด็ดขาด
  async referencedPaths(paths) {
    if (!paths.length) return new Set();
    const { data, error } = await db().from("cases").select("evidence_paths").overlaps("evidence_paths", paths);
    if (error) throw error;
    return new Set((data || []).flatMap((r) => r.evidence_paths || []));
  },
  async deleteFiles(paths) {
    await deleteEvidence(paths);
  },
};

/* ═══════════════ 3) บริการร่าง (CAS ทุกครั้ง) ═══════════════ */
export class DraftUnavailableError extends Error {}

/* ชนกัน (CAS แพ้) = รอสุ่มสั้นๆ แล้วอ่านใหม่ — ผู้ใช้ส่งรูป 10 ใบพร้อมกันเข้ามาคนละอินสแตนซ์ได้ จึงต้องลองหลายรอบ + สุ่มเวลา
   ไม่ให้ทุกตัวชนกันซ้ำจังหวะเดิม (รวมแล้วไม่เกินราว 2 วิ ในกรณีแย่สุด) */
const backoff = (attempt) => new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 30 * (attempt + 1))));

export function createChatIntake(store = chatDraftStore, { now = () => Date.now(), maxRetries = 12, makeSubmissionId = randomUUID } = {}) {
  const iso = (t = now()) => new Date(t).toISOString();

  /* ลบไฟล์ของร่างอย่างปลอดภัย: เฉพาะ path "<uid>/chat/…" ที่ไม่ถูกอ้างในเรื่องใดเลย · ตรวจไม่ได้ (DB ล่ม) = ไม่ลบอะไรเลย */
  async function safeDeleteFiles(uid, paths) {
    const mine = (paths || []).filter((p) => typeof p === "string" && p.startsWith(`${uid}/chat/`));
    if (!mine.length) return 0;
    let referenced;
    try {
      referenced = await store.referencedPaths(mine);
    } catch (e) {
      console.error("chatintake: ตรวจว่าไฟล์อยู่ในเรื่องไม่ได้ — ไม่ลบไฟล์รอบนี้", e?.code || e?.message || e);
      return 0;
    }
    const doomed = mine.filter((p) => !referenced.has(p));
    if (doomed.length) await store.deleteFiles(doomed);
    return doomed.length;
  }

  async function read(uid) {
    try {
      return normalizeDraft(await store.get(uid), uid);
    } catch (e) {
      if (isMissingTableError(e)) throw new DraftUnavailableError("missing");
      throw e;
    }
  }

  /* ร่างค้าง inflight เกิน STALE_INFLIGHT_MS (อินสแตนซ์ตายระหว่างส่ง) → ตรวจผลด้วย submission_id ที่ไม่ซ้ำ
     เท่านั้น ถ้ามีผลตรงกัน = ถือว่าส่งสำเร็จ ไม่มี = คืนรายการกลับเข้าร่าง (ร่างไม่หาย) */
  async function recoverInflight(d) {
    const fl = d.inflight;
    if (!fl || !(now() - ms(d.submitted_at) > STALE_INFLIGHT_MS)) return null;
    let found = null;
    try {
      found = await store.submissionResult(fl.submission_id, fl.mode);
    } catch (e) {
      console.error("chatintake: ตรวจเรื่องที่ค้างส่งไม่ได้ — ยังไม่กู้รอบนี้", e?.code || e?.message || e);
      return null;
    }
    if (found) return { ...d, inflight: null, last_case_no: found.case_no, submitted_at: d.items.length ? null : d.submitted_at };
    return {
      ...d, inflight: null, submitted_at: null,
      items: [...(fl.items || []), ...d.items], evidence_paths: [...(fl.evidence_paths || []), ...d.evidence_paths],
    };
  }

  const FIELDS = ["items", "evidence_paths", "inflight", "awaiting", "pending_type", "phone", "last_case_no", "submitted_at", "phone_nudged_at"];
  const pick = (d) => Object.fromEntries(FIELDS.map((k) => [k, d[k] ?? (k === "items" || k === "evidence_paths" ? [] : null)]));

  /* แก้ร่างแบบ compare-and-swap — fn(draft) คืน { next, result } (next = ร่างใหม่ทั้งก้อน หรือ null = ไม่ต้องเขียน)
     ร่างหมดอายุ/ค้าง inflight ถูกจัดการก่อนส่งให้ fn เสมอ · ไฟล์ของร่างหมดอายุลบหลังเขียนสำเร็จเท่านั้น */
  async function mutate(uid, fn) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const stored = await read(uid);
      let base = stored;
      let doomed = [];
      const recovered = await recoverInflight(base);
      if (recovered) base = recovered;
      if (isDraftExpired(base, now())) {
        doomed = base.evidence_paths;
        base = { ...base, items: [], evidence_paths: [], awaiting: null, pending_type: null, phone_nudged_at: null, submitted_at: null };
      }
      const out = fn(base) || {};
      const dirty = out.next || (base !== stored ? base : null);
      if (!dirty) return { draft: base, result: out.result };
      const t = now();
      const fields = pick(dirty);
      let row;
      if (!stored.exists) {
        row = await store.insert({ line_uid: uid, ...fields, rev: 1, created_at: iso(t), updated_at: iso(t) });
      } else {
        row = await store.update(uid, stored.rev, { ...fields, rev: stored.rev + 1, updated_at: iso(t) });
      }
      if (!row) { await backoff(attempt); continue; } // มีคนแก้ตัดหน้า — รอสุ่มสั้นๆ อ่านใหม่แล้วลองอีกรอบ
      if (doomed.length) await safeDeleteFiles(uid, doomed);
      return { draft: normalizeDraft(row, uid), result: out.result };
    }
    throw new Error("chatintake: แก้ร่างไม่สำเร็จ (มีการแก้พร้อมกันหลายครั้ง)");
  }

  return {
    safeDeleteFiles,

    /* อ่านร่างปัจจุบัน → { ok:true, draft } · ยังไม่รัน migration-14 = { ok:false, reason:"missing" } · DB ล่ม = { ok:false, reason:"error" }
       ร่างหมดอายุ/ค้าง inflight ถูกเก็บกวาดตรงนี้ด้วย (ผ่าน mutate) */
    async load(uid) {
      try {
        const { draft } = await mutate(uid, () => null);
        return { ok: true, draft };
      } catch (e) {
        if (e instanceof DraftUnavailableError) return { ok: false, reason: "missing" };
        console.error("chatintake: อ่านร่างไม่ได้", e?.code || e?.message || e);
        return { ok: false, reason: "error" };
      }
    },

    /* เพิ่มข้อความ/ไฟล์/พิกัด/โน้ตเข้าร่าง — ร่างที่ส่งไปแล้ว (items ว่าง + submitted_at) เปิดเป็นร่างใหม่ให้อัตโนมัติ
       ระหว่างกำลังส่ง (inflight) ยังเพิ่มได้ รายการใหม่จะค้างเป็นร่างถัดไปหลังส่งเสร็จ */
    async append(uid, newItems) {
      const { draft, result } = await mutate(uid, (d) => {
        const r = addItems(d, newItems, now());
        if (!r.added) return { next: null, result: r };
        const next = { ...r.draft };
        if (!d.inflight && d.submitted_at) next.submitted_at = null;
        return { next, result: r };
      });
      return { draft, added: result?.added || 0, rejected: result?.rejected || [] };
    },

    async setAwaitingPhone(uid, type) {
      const { draft } = await mutate(uid, (d) => ({ next: { ...d, awaiting: "phone", pending_type: type, phone_nudged_at: iso() } }));
      return draft;
    },

    /* เตือนขอเบอร์ซ้ำได้ไหม (ไม่เกิน 1 ครั้ง/10 นาที) — จองสิทธิ์ด้วย CAS: สองข้อความพร้อมกันได้คำเตือนครั้งเดียว */
    async claimPhoneNudge(uid) {
      const { result } = await mutate(uid, (d) => {
        if (d.awaiting !== "phone") return { next: null, result: false };
        const last = ms(d.phone_nudged_at);
        if (Number.isFinite(last) && now() - last < PHONE_NUDGE_MS) return { next: null, result: false };
        return { next: { ...d, phone_nudged_at: iso() }, result: true };
      });
      return !!result;
    },

    /* กดส่ง (atomic) — ย้ายรายการ+ไฟล์ทั้งหมดไป inflight แล้วตั้ง submitted_at ในคำสั่งเดียว
       คืน { status: "claimed", claimed } · "empty" (ไม่มีเนื้อหา) · "already" (เพิ่งส่งไปแล้ว ไม่มีรายการใหม่) · "busy" (กำลังส่งอยู่)
       mode: "new" (สร้างเรื่องใหม่ — type/phone) | "append" (เพิ่มเข้าเรื่อง caseNo) */
    async claimSubmit(uid, { mode = "new", type = null, phone = null, caseNo = null } = {}) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        let { draft: d } = await mutate(uid, () => null);
        if (d.inflight) return { status: "busy", draft: d };
        if (!hasSubstance(d)) {
          return d.submitted_at && d.last_case_no ? { status: "already", caseNo: d.last_case_no, draft: d } : { status: "empty", draft: d };
        }
        const t = iso();
        const inflight = { submission_id: makeSubmissionId(), mode, type, phone, case_no: caseNo, items: d.items, evidence_paths: d.evidence_paths, at: t };
        const patch = {
          items: [], evidence_paths: [], inflight, submitted_at: t, awaiting: null, phone_nudged_at: null,
          pending_type: mode === "new" ? type : d.pending_type, rev: d.rev + 1, updated_at: t,
        };
        // ร่างที่เปิดใหม่หลังส่งครั้งก่อน submitted_at ถูกล้างเป็น null ไว้แล้วตอน append — claim ได้เฉพาะ submitted_at is null
        if (d.submitted_at) {
          const reopened = await store.update(uid, d.rev, { submitted_at: null, rev: d.rev + 1, updated_at: t });
          if (!reopened) { await backoff(attempt); continue; }
          d = normalizeDraft(reopened, uid);
          patch.rev = d.rev + 1;
        }
        const row = await store.claimSubmit(uid, d.rev, patch);
        if (row) return { status: "claimed", claimed: inflight, draft: normalizeDraft(row, uid) };
        await backoff(attempt);
      }
      return { status: "busy" };
    },

    /* ส่งสำเร็จ → ล้าง inflight (ไฟล์ตอนนี้เป็นของเรื่องแล้ว — ร่างไม่อ้างถึงอีก) เก็บเลขที่เรื่อง+เบอร์ไว้ใช้ครั้งหน้า
       ถ้ามีข้อความใหม่เข้ามาระหว่างส่ง → เปิดเป็นร่างใหม่ (submitted_at = null) */
    async complete(uid, { caseNo, phone = null } = {}) {
      const { draft } = await mutate(uid, (d) => ({
        next: {
          ...d, inflight: null, last_case_no: caseNo || d.last_case_no, phone: phone || d.phone,
          submitted_at: d.items.length ? null : d.submitted_at || iso(), awaiting: null, pending_type: null,
        },
      }));
      return draft;
    },

    /* ส่งไม่สำเร็จ (createCase พัง) → คืนรายการ+ไฟล์กลับเข้าร่าง (ต่อหน้ารายการที่เพิ่งเข้ามาระหว่างส่ง) ร่างไม่หาย */
    async release(uid) {
      const { draft } = await mutate(uid, (d) => {
        const fl = d.inflight;
        if (!fl) return { next: { ...d, submitted_at: d.items.length ? null : d.submitted_at } };
        return {
          next: {
            ...d, inflight: null, submitted_at: null,
            items: [...(fl.items || []), ...d.items], evidence_paths: [...(fl.evidence_paths || []), ...d.evidence_paths],
          },
        };
      });
      return draft;
    },

    /* ผู้ใช้กดยกเลิก → ล้างร่าง + ลบไฟล์ของร่าง (ไม่แตะร่างที่กำลังส่ง) */
    async cancel(uid) {
      const { draft, result } = await mutate(uid, (d) => {
        if (d.inflight) return { next: null, result: { busy: true, files: [] } };
        return {
          next: { ...d, items: [], evidence_paths: [], awaiting: null, pending_type: null, phone_nudged_at: null, submitted_at: null },
          result: { busy: false, files: d.evidence_paths },
        };
      });
      if (result?.files?.length) await safeDeleteFiles(uid, result.files);
      return { draft, busy: !!result?.busy };
    },

    /* cron รายวัน — ร่างที่ยังไม่ส่งเกิน 24 ชม. → ลบแถวก่อน (CAS) แล้วค่อยลบไฟล์ (ลบแถวไม่สำเร็จ = มีคนเพิ่งแตะ ข้ามไป)
       แถวที่ส่งแล้วเกิน 2 วัน → ลบแถว (ไฟล์ย้ายเข้าเรื่องไปแล้ว ไม่แตะ) · ค้าง inflight เกิน 2 วัน → ลบแถว + ลบเฉพาะไฟล์
       "<uid>/chat/…" ที่ไม่อยู่ในเรื่องใดเลย · ⛔ ไฟล์ที่ถูกอ้างใน cases.evidence_paths ไม่ถูกลบในทุกกรณี */
    async purge() {
      const t = now();
      const rows = await store.listOlderThan(iso(t - DRAFT_TTL_MS));
      const out = { drafts: 0, submitted: 0, files: 0, skipped: 0 };
      for (const row of rows) {
        const d = normalizeDraft(row, row.line_uid);
        const age = t - ms(d.updated_at);
        const open = !d.inflight && (d.items.length || d.evidence_paths.length);
        if (!open && age <= SUBMITTED_KEEP_MS) continue;
        if (!(await store.remove(d.line_uid, d.rev).catch(() => false))) { out.skipped++; continue; }
        const files = open ? d.evidence_paths : d.inflight ? d.inflight.evidence_paths || [] : [];
        out.files += await safeDeleteFiles(d.line_uid, files);
        if (open) out.drafts++; else out.submitted++;
      }
      return out;
    },
  };
}

/* ═══════════════ 4) ไฟล์ที่ประชาชนส่งเข้าแชต ═══════════════
   message: event.message ของไลน์ (image/file) · คืน
     { item }                     — อัปโหลดสำเร็จ ได้รายการ {t:"file", path, kind, name?} พร้อมเพิ่มเข้าร่าง
     { note, userReason }         — ไม่เก็บไฟล์ (ชนิดไม่รับ/ใหญ่เกิน/โหลดไม่ได้/เวลาไม่พอ) → โน้ตถึงเจ้าหน้าที่ + เหตุผลบอกผู้ใช้
   deadline: เวลา (ms) ที่ต้องเสร็จก่อน — webhook มี maxDuration 30 วิ โหลดทีละไฟล์ เวลาเหลือน้อยไม่เริ่มโหลด */
const MIN_DOWNLOAD_MS = 4000;
export async function ingestLineMedia(uid, message, { deadline = Date.now() + 15000, now = () => Date.now() } = {}) {
  const isFile = message?.type === "file";
  const label = isFile ? `ไฟล์${message.fileName ? ` "${String(message.fileName).slice(0, 80)}"` : ""}` : "รูปภาพ";
  if (message?.contentProvider?.type === "external") {
    return { note: `ผู้แจ้งส่ง${label}จากลิงก์ภายนอก — ระบบไม่ได้บันทึกไฟล์`, userReason: "failed" };
  }
  if (isFile && Number(message.fileSize) > MAX_CHAT_FILE_BYTES) {
    return { note: `ผู้แจ้งส่ง${label} ขนาดเกิน 8MB — ระบบไม่ได้บันทึกไฟล์`, userReason: "too_large" };
  }
  if (isFile && !/\.(pdf|jpe?g|png)$/i.test(String(message.fileName || ""))) {
    return { note: `ผู้แจ้งส่ง${label} (ชนิดที่ระบบไม่รับ) — ระบบไม่ได้บันทึกไฟล์`, userReason: "type" };
  }
  const budget = Math.min(15000, deadline - now() - 3000);
  if (budget < MIN_DOWNLOAD_MS) {
    return { note: `ผู้แจ้งส่ง${label} แต่ระบบรับไม่ทันเวลา — ระบบไม่ได้บันทึกไฟล์`, userReason: "failed" };
  }
  const got = await getMessageContent(message.id, { timeout: budget, maxBytes: MAX_CHAT_FILE_BYTES });
  if (!got) return { note: `ผู้แจ้งส่ง${label} แต่ระบบโหลดไฟล์ไม่สำเร็จ (อาจใหญ่เกิน 8MB)`, userReason: "failed" };
  const type = evidenceTypeOf(got.buffer);
  if (!type) return { note: `ผู้แจ้งส่ง${label} (ชนิดที่ระบบไม่รับ) — ระบบไม่ได้บันทึกไฟล์`, userReason: "type" };
  const path = chatEvidencePath(uid, type.ext, now());
  if (!(await storeEvidenceBuffer(path, got.buffer, type.contentType))) {
    return { note: `ผู้แจ้งส่ง${label} แต่ระบบบันทึกไฟล์ไม่สำเร็จ`, userReason: "failed" };
  }
  const item = { t: "file", path, kind: type.ext === "pdf" ? "pdf" : "image" };
  if (isFile && message.fileName) item.name = String(message.fileName).slice(0, 80);
  return { item };
}

/* พิกัดที่ผู้ใช้แชร์ → ข้อความบรรทัดเดียว (ASCII ลิงก์ — แตะเปิดแผนที่ได้ในหลังบ้าน) */
export function locationItemText(message) {
  const lat = Number(message?.latitude);
  const lng = Number(message?.longitude);
  const name = [message?.title, message?.address].filter(Boolean).map((s) => String(s).slice(0, 100)).join(" · ");
  const link = Number.isFinite(lat) && Number.isFinite(lng) ? ` https://www.google.com/maps?q=${lat},${lng}` : "";
  return `📍 ${name || "ตำแหน่งที่ผู้แจ้งแชร์"}${link}`;
}
