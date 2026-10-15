/* scripts/test-chatintake.mjs — "รับเรื่องทางแชต" (2 ต.ค. 69 — บอสสั่ง "เวลาประชาชนพิมพ์ text มาให้รับเรื่องได้ด้วย
   ไม่จำเป็นต้องกรอกแบบฟอร์มอย่างเดียว" · มติบอส "เล่าอิสระ แล้วกดยืนยัน") — ล็อกกันถอยหลัง:
   1) ฟังก์ชันบริสุทธิ์: extractPhone / isPhoneOnly / isPhoneSkip / guessCategory / buildCaseDetail / เพดาน / หมดอายุ
   2) บริการร่าง (store ปลอม + นาฬิกาปลอม): กดยืนยันซ้ำ/พร้อมกันได้เรื่องเดียว · createCase พังแล้วร่างไม่หาย · append พร้อมกันไม่หาย
      · ร่างหมดอายุลบพร้อมไฟล์ · ⛔ ไฟล์ที่เข้าเรื่องแล้วไม่ถูกลบ · ค้าง inflight กู้คืนได้ · เตือนขอเบอร์ไม่เกิน 1 ครั้ง/10 นาที
   3) webhook ทั้งเส้น (ลายเซ็นจริง + ดัก fetch LINE/Supabase/Storage ในเครื่อง ไม่ยิงเน็ตจริง — กฎข้อ 5):
      ข้อความ → การ์ดรับเรื่อง → กดส่ง → ขอเบอร์ → พิมพ์เบอร์ → เลขที่เรื่อง · รูป → อัปโหลด path ถูก · ทักทาย/ขอบคุณ/สติกเกอร์
      ไม่เข้าร่าง · เพิ่มข้อมูลเข้าเรื่องเดิม · ยังไม่รัน migration-14 → พฤติกรรมเดิม · ไม่มีข้อความ/ชื่อ/เบอร์ประชาชนใน log */
process.env.LINE_CHANNEL_SECRET = "test-line-secret-ci-only";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "fake-line-token";
process.env.SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_KEY = "fake-service-key";
process.env.FORM_SECRET = "test-form-secret-ci-only";
delete process.env.MAIL_USER;
delete process.env.MAIL_APP_PASSWORD;

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable } from "node:stream";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checked++; }

// ═══════════════════ จำลอง Supabase (PostgREST + Storage) + LINE ═══════════════════
const STAFF_UID = "U" + "a".repeat(32);
const UID = "U" + "c".repeat(32);
const UID2 = "U" + "d".repeat(32);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const fake = {
  noChatTable: false, // จำลอง "ยังไม่รัน migration-14" (ไม่มีตาราง chat_drafts)
  chatCheck: true, // false = check ของ cases.source ยังไม่รู้จัก 'chat' (23514)
  failNextCaseNo: false,
  seq: 0,
  tables: {
    cases: [], case_events: [], keyword_log: [], chat_drafts: [],
    settings: [
      { key: "appointment_enabled", value: true }, { key: "phone", value: "0 3552 5500" }, { key: "responder_label", value: "เจ้าหน้าที่" },
    ],
    staff: [{ id: 1, role: "admin", active: true, display_name: "ผู้ทดสอบ", line_uid: STAFF_UID, email: "s@example.test", notify_line: true, notify_email: true, notify_categories: null }],
  },
  storage: new Map(), // path → Buffer (bucket evidence)
  storageDeletes: [],
  lineCalls: [],
};
let nextId = 1;
const jsonRes = (status, body, headers = {}) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
function matchFilter(row, key, raw) {
  const v = row[key];
  const [op, ...rest] = raw.split(".");
  const arg = rest.join(".");
  if (op === "eq") return String(v) === arg;
  if (op === "is") return arg === "null" ? v == null : String(v) === arg;
  if (op === "gte") return String(v) >= arg;
  if (op === "gt") return String(v) > arg;
  if (op === "lt") return String(v) < arg;
  if (op === "lte") return String(v) <= arg;
  if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(v));
  if (op === "ov") { const want = arg.replace(/^\{|\}$/g, "").split(",").map((s) => s.replace(/^"|"$/g, "")); return (v || []).some((p) => want.includes(p)); }
  if (op === "not") return !matchFilter(row, key, arg);
  throw new Error("fake postgrest: ไม่รองรับ operator " + raw);
}
const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);
const filtered = (table, sp) => table.filter((row) => [...sp.entries()].every(([k, v]) => RESERVED.has(k) || matchFilter(row, k, v)));
function ordered(rows, sp) {
  const o = sp.get("order");
  if (!o) return rows;
  const [col, dir] = o.split(".");
  return [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (dir === "desc" ? -1 : 1));
}
const tick = () => new Promise((r) => setImmediate(r)); // ให้คำขอพร้อมกันสลับลำดับกันจริง (จำลองหลายอินสแตนซ์)

globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  if (u.host === "api.line.me") {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    fake.lineCalls.push({ path: u.pathname, body });
    if (u.pathname.startsWith("/v2/bot/profile/")) return jsonRes(200, { displayName: "สมชาย ✨", userId: u.pathname.split("/").pop() });
    if (u.pathname.endsWith("/message/quota")) return jsonRes(200, { type: "limited", value: 300 });
    if (u.pathname.endsWith("/message/quota/consumption")) return jsonRes(200, { totalUsage: 0 });
    return jsonRes(200, {});
  }
  if (u.host === "api-data.line.me") {
    fake.lineCalls.push({ path: u.pathname, body: null });
    const id = u.pathname.split("/")[4];
    if (id.startsWith("img")) return new Response(JPEG, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(JPEG.length) } });
    if (id.startsWith("zip")) return new Response(Buffer.from("PK\x03\x04zipzipzip"), { status: 200, headers: { "Content-Type": "application/zip" } });
    return new Response("", { status: 404 });
  }
  if (u.host !== "fake-supabase.test") throw new Error("ห้ามยิงเน็ตจริงในเทสต์: " + u.href);
  await tick();

  // ── Storage (bucket evidence) ──
  if (u.pathname.startsWith("/storage/v1/object/")) {
    const rest = decodeURIComponent(u.pathname.slice("/storage/v1/object/".length));
    if (method === "POST" && rest.startsWith("evidence/")) {
      const path = rest.slice("evidence/".length);
      if (fake.storage.has(path)) return jsonRes(409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      const b = init.body;
      fake.storage.set(path, Buffer.isBuffer(b) ? b : Buffer.from(b instanceof Uint8Array ? b : String(b)));
      return jsonRes(200, { Id: "x", Key: "evidence/" + path });
    }
    if (method === "DELETE" && rest === "evidence") {
      const { prefixes } = JSON.parse(String(init.body));
      for (const p of prefixes) { fake.storage.delete(p); fake.storageDeletes.push(p); }
      return jsonRes(200, prefixes.map((name) => ({ name })));
    }
    throw new Error("fake storage: ไม่รองรับ " + method + " " + u.pathname);
  }

  const path = u.pathname.replace(/^\/rest\/v1\//, "");
  if (path === "rpc/next_case_no") {
    if (fake.failNextCaseNo) { fake.failNextCaseNo = false; return jsonRes(500, { code: "XX000", message: "sequence ล่มจำลอง" }); }
    return jsonRes(200, `LG-2569-${String(++fake.seq).padStart(6, "0")}`);
  }
  if (path === "rpc/append_chat_submission") {
    const p = JSON.parse(String(init.body));
    const prior = fake.tables.case_events.find((e) => e.idempotency_key === p.p_submission_id);
    const row = fake.tables.cases.find((c) => c.id === (prior?.case_id || p.p_case_id));
    if (!row) return jsonRes(400, { code: "P0001", message: "case not found" });
    if (!prior) {
      row.evidence_paths = [...new Set([...(row.evidence_paths || []), ...(p.p_paths || [])])].slice(0, 12);
      row.updated_at = new Date().toISOString();
      fake.tables.case_events.push({ id: nextId++, case_id: row.id, actor: "citizen", action: "citizen_message", note: p.p_note, idempotency_key: p.p_submission_id });
    }
    return jsonRes(200, JSON.parse(JSON.stringify(row)));
  }
  if (path === "chat_drafts" && fake.noChatTable) {
    return jsonRes(404, { code: "PGRST205", message: "Could not find the table 'public.chat_drafts' in the schema cache" });
  }
  const table = fake.tables[path];
  if (!table) return jsonRes(404, { code: "PGRST205", message: `Could not find the table 'public.${path}' in the schema cache` });
  const wantObject = (headers.get("Accept") || "").includes("vnd.pgrst.object");
  const prefer = headers.get("Prefer") || "";
  const reply = (rows, status = 200) => {
    if (wantObject) {
      if (rows.length !== 1) return jsonRes(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return jsonRes(status, rows[0]);
    }
    return jsonRes(status, rows);
  };
  const copy = (r) => JSON.parse(JSON.stringify(r));

  if (method === "GET") {
    let rows = ordered(filtered(table, u.searchParams), u.searchParams);
    const limit = Number(u.searchParams.get("limit"));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    return reply(rows.map(copy));
  }
  if (method === "POST") {
    const incoming = JSON.parse(String(init.body));
    const list = Array.isArray(incoming) ? incoming : [incoming];
    const out = [];
    for (const r of list) {
      if (path === "chat_drafts" && table.some((x) => x.line_uid === r.line_uid)) {
        return jsonRes(409, { code: "23505", message: "duplicate key value violates unique constraint \"chat_drafts_pkey\"" });
      }
      if (path === "cases" && r.source === "chat" && !fake.chatCheck) {
        return jsonRes(400, { code: "23514", message: "new row for relation \"cases\" violates check constraint \"cases_source_check\"" });
      }
      if (path === "cases" && r.submission_id && table.some((x) => x.submission_id === r.submission_id)) {
        return jsonRes(409, { code: "23505", message: "duplicate key value violates unique constraint cases_submission_id_uidx" });
      }
      const row = path === "chat_drafts" ? { ...r } : { id: nextId++, created_at: new Date().toISOString(), ...r };
      if (path === "cases") { row.status = row.status || "new"; row.updated_at = row.created_at; if (!("source" in row)) row.source = "line"; }
      table.push(row);
      out.push(copy(row));
    }
    return /return=representation/.test(prefer) ? reply(out, 201) : new Response(null, { status: 201 });
  }
  if (method === "PATCH") {
    const patch = JSON.parse(String(init.body));
    const rows = filtered(table, u.searchParams);
    for (const r of rows) Object.assign(r, patch);
    return /return=representation/.test(prefer) ? reply(rows.map(copy)) : new Response(null, { status: 204 });
  }
  if (method === "DELETE") {
    const rows = filtered(table, u.searchParams);
    fake.tables[path] = table.filter((r) => !rows.includes(r));
    return /return=representation/.test(prefer) ? reply(rows.map(copy)) : new Response(null, { status: 204 });
  }
  throw new Error("fake postgrest: ไม่รองรับ " + method);
};

// ═══════════════════ โหลดโค้ดจริงหลังดัก fetch แล้ว ═══════════════════
const CI = await import("../api/_chatintake.js");
const {
  extractPhone, isPhoneOnly, isPhoneSkip, guessCategory, buildCaseDetail, buildAppendNote, addItems, summarizeDraft, hasSubstance,
  isDraftExpired, bkkStamp, createChatIntake, emptyDraft, MAX_DRAFT_CHARS, MAX_DRAFT_ITEMS, MAX_DRAFT_FILES, DRAFT_TTL_MS,
  SUBMITTED_KEEP_MS, PHONE_NUDGE_MS, STALE_INFLIGHT_MS, chatDraftStore,
} = CI;
const { routeText, isIntakeContent, needsLoadingIndicator } = await import("../api/_chatgate.js");
const { isChatCase, CHAT_SOURCE_TAG } = await import("../api/_cases.js");
const { staffNewCaseText } = await import("../api/_notify.js");
const { caseNotifyMailText } = await import("../api/_mailer.js");
const { evidenceTypeOf } = await import("../api/_evidence.js");
const { default: webhook } = await import("../api/line-webhook.js");

// ═══════════════════ 1) ฟังก์ชันบริสุทธิ์ ═══════════════════
eq(extractPhone("เบอร์ 081-234-5678 ค่ะ"), "0812345678", "มือถือมีขีด");
eq(extractPhone("0812345678"), "0812345678", "มือถือล้วน");
eq(extractPhone("โทร 081 234 5678 ครับ"), "0812345678", "มือถือเว้นวรรค");
eq(extractPhone("081.234.5678"), "0812345678", "มือถือคั่นจุด");
eq(extractPhone("+66 81 234 5678"), "0812345678", "+66 → 0");
eq(extractPhone("ติดต่อ 02-123-4567"), "021234567", "เบอร์บ้าน กทม.");
eq(extractPhone("035-431-751"), "035431751", "เบอร์บ้านต่างจังหวัด 9 หลัก");
eq(extractPhone("๐๘๑๒๓๔๕๖๗๘"), "0812345678", "เลขไทยต้องอ่านได้");
eq(extractPhone("เลขบัตร 1 1037 00123 45 6"), null, "เลขบัตรประชาชนต้องไม่ถูกตีเป็นเบอร์");
eq(extractPhone("1103700123456"), null, "เลข 13 หลักติดกันต้องไม่ใช่เบอร์");
eq(extractPhone("ติดตาม LG-2569-000123"), null, "เลขที่เรื่องไม่ใช่เบอร์");
eq(extractPhone("วันที่ 02/10/2569 เวลา 08.30"), null, "วันที่/เวลาไม่ใช่เบอร์");
eq(extractPhone("รหัสไปรษณีย์ 72000"), null, "รหัสไปรษณีย์ไม่ใช่เบอร์");
eq(extractPhone("08123456789"), null, "11 หลักไม่ใช่เบอร์");
eq(extractPhone("โอนเข้าบัญชีกสิกร 089-123-4567 ไปแล้ว"), null, "เลขบัญชีที่ขึ้นต้น 08/09 ต้องไม่ถูกตีเป็นเบอร์ติดต่อกลับ");
eq(extractPhone("มิจฉาชีพโทรมาจากเบอร์ 0812345678 ส่วนเบอร์ผม 0899999999 ค่ะ"), "0899999999", "เบอร์คนร้ายต้องข้าม ใช้เบอร์ของผู้แจ้ง");
eq(extractPhone("ผมโทรมาสอบถามครับ เบอร์ผม 0812345678"), "0812345678", "คำว่าโทรมาที่ไกลจากเบอร์ไม่ทำให้พลาดเบอร์จริง");
ok(isPhoneOnly("0812345678"), "เบอร์ล้วน = phone only");
ok(isPhoneOnly("เบอร์ 081-234-5678 ค่ะ"), "เบอร์ + คำประกอบ = phone only");
ok(!isPhoneOnly("0812345678 สมชาย ใจดี"), "มีชื่อปน = ต้องเก็บข้อความด้วย");
ok(isPhoneSkip("ไม่มีเบอร์ครับ") && isPhoneSkip("ข้าม") && isPhoneSkip("ไม่สะดวกให้เบอร์ค่ะ"), "คำตอบไม่ให้เบอร์");
ok(!isPhoneSkip("ไม่มีเงินจ่ายหนี้ครับ"), "ประโยคเล่าเรื่องที่ขึ้นต้นว่า ไม่มี ต้องไม่ถือเป็นข้าม");
eq(guessCategory("โดนโกงเงินจากแก๊งคอลเซ็นเตอร์"), "scam", "หมวดจากพจนานุกรมหมวดกฎหมาย");
eq(guessCategory("ถูกทวงหนี้นอกระบบทุกวัน"), "debt", "หมวดหนี้");
eq(guessCategory("เพื่อนบ้านสร้างรั้วรุกล้ำที่ดิน"), "land", "หมวดที่ดิน (ไม่อยู่ในพจนานุกรม)");
eq(guessCategory("รถชนกันที่สี่แยก"), "criminal", "หมวดอุบัติเหตุ/คดีอาญา");
eq(guessCategory("สอบถามทั่วไปค่ะ"), "other", "ไม่เจอหมวด = other");
ok(evidenceTypeOf(JPEG)?.ext === "jpg" && evidenceTypeOf(Buffer.from("%PDF-1.7"))?.ext === "pdf" && evidenceTypeOf(Buffer.from("PK\x03\x04")) === null, "ตรวจหัวไฟล์ jpg/pdf ผ่าน zip ไม่ผ่าน");

eq(bkkStamp("2026-10-02T07:05:00Z"), "02/10 14:05", "เวลาไทย 24 ชม.");
eq(bkkStamp("2026-10-01T18:30:00Z"), "02/10 01:30", "ข้ามวันตามเวลาไทย");
{
  const d = {
    items: [
      { t: "text", at: "2026-10-02T07:05:00Z", text: "เพื่อนบ้านรุกล้ำที่ดิน" },
      { t: "file", at: "2026-10-02T07:06:00Z", path: "U/chat/1-a.jpg", kind: "image" },
      { t: "file", at: "2026-10-02T07:06:30Z", path: "U/chat/2-b.pdf", kind: "pdf", name: "โฉนด.pdf" },
      { t: "location", at: "2026-10-02T07:07:00Z", text: "📍 บ้าน https://www.google.com/maps?q=14.4,100.1" },
      { t: "note", at: "2026-10-02T07:08:00Z", text: "ผู้แจ้งส่งวิดีโอ — ระบบไม่ได้บันทึกไฟล์" },
    ],
    evidence_paths: ["U/chat/1-a.jpg", "U/chat/2-b.pdf"],
  };
  const detail = buildCaseDetail(d, { displayName: "สมชาย", phone: "0812345678", phoneFrom: "typed" });
  ok(detail.includes("[02/10 14:05] เพื่อนบ้านรุกล้ำที่ดิน"), "รายละเอียดเรียงเวลาไทย [dd/mm HH:MM]");
  ok(detail.includes("แนบรูปภาพ (ไฟล์ที่ 1)") && detail.includes("แนบไฟล์ PDF \"โฉนด.pdf\" (ไฟล์ที่ 2)"), "บรรทัดไฟล์แนบ");
  ok(detail.includes("📍 บ้าน https://www.google.com/maps?q=14.4,100.1"), "บรรทัดพิกัด");
  ok(detail.includes("⚠️ ผู้แจ้งส่งวิดีโอ"), "โน้ตถึงเจ้าหน้าที่");
  ok(detail.includes("ข้อความ 1 · ไฟล์แนบ 2") && detail.includes("พิกัด 1"), "บรรทัดสรุป");
  ok(detail.includes("มาจากชื่อโปรไฟล์ไลน์"), "บอกว่าชื่อมาจากโปรไฟล์ไลน์");
  ok(detail.includes("เบอร์ติดต่อกลับ 0812345678"), "บอกเบอร์และที่มา");
  ok(buildCaseDetail(d, {}).includes("ไม่ได้ให้เบอร์โทร"), "ไม่มีเบอร์ต้องบอกเจ้าหน้าที่ให้ติดต่อทางแชต");
  const note = buildAppendNote(d.items, { filesAdded: 2, filesDropped: 1 });
  ok(note.includes("[02/10 14:05]") && note.includes("แนบไฟล์เพิ่ม 2 ไฟล์") && note.includes("อีก 1 ไฟล์ไม่ได้บันทึก"), "บันทึกไทม์ไลน์เพิ่มข้อมูล");
  const s = summarizeDraft({ items: [{ t: "text", text: "ก".repeat(100) }], evidence_paths: [] });
  ok(s.preview.length <= 60 && s.preview.endsWith("…"), "ตัวอย่างข้อความในการ์ดสั้นไม่เกิน 60 ตัว");
}
{
  // เพดาน: 4,000 ตัว (ตัดพร้อมโน้ต) · 40 รายการ · 10 ไฟล์
  let d = emptyDraft("U1");
  let r = addItems(d, [{ t: "text", text: "ก".repeat(3990) }, { t: "text", text: "ข".repeat(50) }]);
  const chars = r.draft.items.filter((i) => i.t === "text").reduce((n, i) => n + i.text.length, 0);
  eq(chars, MAX_DRAFT_CHARS, "ข้อความรวมต้องไม่เกิน 4,000 ตัว");
  ok(r.draft.items.some((i) => i.t === "note" && /ตัดส่วนเกิน/.test(i.text)), "ตัดข้อความแล้วต้องมีโน้ตบอกเจ้าหน้าที่");
  r = addItems(r.draft, [{ t: "text", text: "ค" }]);
  eq(r.rejected[0]?.reason, "chars", "เต็ม 4,000 ตัวแล้วรับข้อความเพิ่มไม่ได้");
  d = emptyDraft("U1");
  r = addItems(d, Array.from({ length: 45 }, (_, i) => ({ t: "text", text: "x" + i })));
  eq(r.draft.items.length, MAX_DRAFT_ITEMS, "รายการไม่เกิน 40");
  eq(r.rejected.filter((x) => x.reason === "items").length, 5, "ส่วนเกินถูกปฏิเสธพร้อมเหตุผล");
  r = addItems(emptyDraft("U1"), Array.from({ length: 12 }, (_, i) => ({ t: "file", path: `U1/chat/${i}.jpg`, kind: "image" })));
  eq(r.draft.evidence_paths.length, MAX_DRAFT_FILES, "ไฟล์ไม่เกิน 10 ต่อร่าง");
  eq(r.rejected.filter((x) => x.reason === "files").length, 2, "ไฟล์ส่วนเกินถูกปฏิเสธ (ผู้เรียกลบไฟล์ทิ้ง)");
  ok(!hasSubstance({ items: [{ t: "note", text: "วิดีโอ" }], evidence_paths: [] }), "มีแต่โน้ต (วิดีโอ) = ยังส่งเป็นเรื่องไม่ได้");
  ok(hasSubstance({ items: [{ t: "location", text: "📍" }], evidence_paths: [] }), "พิกัดอย่างเดียว = มีเนื้อหา");
  const now = Date.parse("2026-10-02T10:00:00Z");
  ok(isDraftExpired({ items: [{ t: "text" }], evidence_paths: [], updated_at: new Date(now - DRAFT_TTL_MS - 1000).toISOString() }, now), "ร่างเกิน 24 ชม. = หมดอายุ");
  ok(!isDraftExpired({ items: [{ t: "text" }], evidence_paths: [], updated_at: new Date(now - 3600000).toISOString() }, now), "ร่าง 1 ชม. ยังไม่หมดอายุ");
  ok(!isDraftExpired({ items: [], evidence_paths: [], inflight: { items: [] }, updated_at: "2020-01-01T00:00:00Z" }, now), "ร่างที่กำลังส่ง (inflight) ไม่หมดอายุ");
}

// ═══════════════════ 1b) routeText กับรับเรื่องทางแชต ═══════════════════
eq(routeText("เบอร์ 0812345678 ค่ะ", { awaitingPhone: true }).kind, "phone", "ระหว่างรอเบอร์ เบอร์ต้องชนะเจตนา contact");
eq(routeText("เบอร์ 0812345678 ค่ะ", { awaitingPhone: true }).phone, "0812345678", "ส่งเบอร์ที่อ่านได้ต่อ");
eq(routeText("เบอร์ 0812345678 ค่ะ").kind, "contact", "ไม่ได้รอเบอร์ = เจตนาเดิม (ขอเบอร์)");
eq(routeText("ไม่มีเบอร์ครับ", { awaitingPhone: true }).kind, "phoneSkip", "ระหว่างรอเบอร์ พิมพ์ไม่มีเบอร์ = ข้าม");
eq(routeText("ถูกทำร้าย โทร 0812345678", { awaitingPhone: true }).kind, "urgent", "คำเร่งด่วนต้องชนะเบอร์ (ความปลอดภัยมาก่อน)");
eq(routeText("LG-2569-000123", { awaitingPhone: true }).kind, "status", "เลขที่เรื่องยังทำงานปกติระหว่างรอเบอร์");
eq(routeText("เมนู", { awaitingPhone: true }).kind, "menu", "เมนูยังทำงานปกติระหว่างรอเบอร์");
ok(routeText("หนี้สิน").story === false, "คำหมวดสั้น = การ์ดหมวดเดิม");
ok(routeText("ผมเป็นหนี้สินบัตรเครดิตหลายใบ ตอนนี้ถูกโทรทวงทุกวันจนทำงานไม่ได้ครับ").story === true, "คำหมวดในเรื่องเล่ายาว = story");
for (const t of ["เพื่อนบ้านรุกล้ำที่ดิน", "มรดก", "อยากปรึกษาเรื่องที่ดินครับ", "อยากร้องเรียนครับ", "ขอจองคิวครับ"]) {
  ok(isIntakeContent(routeText(t)), `"${t}" มีเนื้อหาเรื่อง → เข้าร่าง`);
}
for (const t of ["สวัสดีครับ", "ขอบคุณครับ", "🙏", "เมนู", "LG-2569-000123", "ขอเบอร์โทรหน่อยครับ", "ฟรีไหมคะ", "อยากอ่านความรู้กฎหมาย", "มีคนอยู่ไหมครับ", "ถูกทำร้ายร่างกาย"]) {
  ok(!isIntakeContent(routeText(t)), `"${t}" ต้องไม่เข้าร่าง`);
}
ok(!needsLoadingIndicator({ type: "postback", postback: { data: "lg:intake:type" } }), "ปุ่มเปิดคีย์บอร์ด (ไม่ตอบ) ห้ามโชว์กำลังพิมพ์ค้าง");
ok(needsLoadingIndicator({ type: "postback", postback: { data: "lg:intake:consult" } }), "ปุ่มส่งเรื่องโชว์กำลังพิมพ์ได้");

// ═══════════════════ 1c) ข้อความแจ้งเจ้าหน้าที่ ═══════════════════
{
  const chatAppt = { case_no: "LG-2569-000009", case_type: "appointment", category: "land", source: "chat", citizen_line_uid: UID, citizen_phone: null, detail: "x" };
  ok(isChatCase(chatAppt) && isChatCase({ source: "line", detail: "abc\n\n" + CHAT_SOURCE_TAG }) && !isChatCase({ source: "line", detail: "abc" }), "isChatCase ดูได้ทั้ง source และป้ายท้ายรายละเอียด");
  const t = staffNewCaseText(chatAppt);
  ok(t.includes("💬 แจ้งทางแชตไลน์") && t.includes("ยังไม่ระบุ"), "แจ้งเตือนไลน์บอกช่องทางแชต + จองคิวยังไม่ระบุวัน");
  const m = caseNotifyMailText({ ...chatAppt, citizen_phone: "0812345678" });
  ok(m.includes("ช่องทาง: 💬 แจ้งทางแชตไลน์") && m.includes("ยังไม่ระบุ — กรุณาโทรนัด"), "อีเมลบอกช่องทางแชต + ให้โทรนัด");
  ok(!caseNotifyMailText({ case_no: "LG-2569-000010", case_type: "consult", category: "debt", source: "line", citizen_line_uid: UID, detail: "x" }).includes("แชตไลน์"), "เรื่องจากฟอร์มไม่มีป้ายแชต");
}

// ═══════════════════ 2) บริการร่าง: store ปลอมในหน่วยความจำ + นาฬิกาปลอม ═══════════════════
function memStore() {
  const rows = new Map();
  const st = {
    rows, files: new Set(), deleted: [], cases: [], submissions: [], fail: {},
    async get(uid) { await tick(); if (st.fail.missing) throw { code: "PGRST205", message: "Could not find the table 'public.chat_drafts'" }; const r = rows.get(uid); return r ? structuredClone(r) : null; },
    async insert(row) { await tick(); if (rows.has(row.line_uid)) return null; rows.set(row.line_uid, structuredClone(row)); return structuredClone(row); },
    async update(uid, rev, patch) { await tick(); const r = rows.get(uid); if (!r || r.rev !== rev) return null; Object.assign(r, structuredClone(patch)); return structuredClone(r); },
    async claimSubmit(uid, rev, patch) { await tick(); const r = rows.get(uid); if (!r || r.rev !== rev || r.submitted_at != null || r.inflight != null) return null; Object.assign(r, structuredClone(patch)); return structuredClone(r); },
    async remove(uid, rev) { await tick(); const r = rows.get(uid); if (!r || r.rev !== rev) return false; rows.delete(uid); return true; },
    async listOlderThan(iso) { return [...rows.values()].filter((r) => r.updated_at < iso).map((r) => structuredClone(r)); },
    async submissionResult(submissionId, mode) {
      return st.submissions.find((x) => x.submission_id === submissionId && x.mode === mode) || null;
    },
    async referencedPaths(paths) { return new Set(st.cases.flatMap((c) => c.paths).filter((p) => paths.includes(p))); },
    async deleteFiles(paths) { for (const p of paths) { st.files.delete(p); st.deleted.push(p); } },
  };
  return st;
}
let clock = Date.parse("2026-10-02T03:00:00Z");
const now = () => clock;
{
  const st = memStore();
  const svc = createChatIntake(st, { now });
  const realErr = console.error;
  console.error = () => {};
  st.fail.missing = true;
  eq((await svc.load("U1")).reason, "missing", "ยังไม่รัน migration-14 → load คืน missing (ผู้เรียกถอยไปพฤติกรรมเดิม)");
  st.fail.missing = false;
  console.error = realErr;

  eq((await svc.load("U1")).draft.exists, false, "ผู้ใช้ใหม่ load แล้วไม่สร้างแถวเปล่า");
  eq(st.rows.size, 0, "load เฉยๆ ไม่เขียน DB");
  // append พร้อมกัน 6 ชิ้น (จำลองรูป/ข้อความเข้ามาคนละอินสแตนซ์) — ต้องไม่หายสักชิ้น
  await Promise.all(Array.from({ length: 6 }, (_, i) => svc.append("U1", [{ t: "text", text: "ข้อความ " + i }])));
  eq(st.rows.get("U1").items.length, 6, "append พร้อมกันต้องครบทุกชิ้น (compare-and-swap)");
  // กดส่งพร้อมกัน 2 ครั้ง → claimed ครั้งเดียว
  const [a, b] = await Promise.all([svc.claimSubmit("U1", { type: "consult", phone: "0812345678" }), svc.claimSubmit("U1", { type: "consult" })]);
  eq([a.status, b.status].filter((s) => s === "claimed").length, 1, "กดส่งพร้อมกัน 2 ครั้งต้องได้สิทธิ์สร้างเรื่องครั้งเดียว");
  ok(["busy", "already"].includes(a.status === "claimed" ? b.status : a.status), "ครั้งที่สองได้ busy (กำลังส่ง)");
  const claimed = (a.status === "claimed" ? a : b).claimed;
  eq(claimed.items.length, 6, "inflight ถือรายการทั้งหมดของร่าง");
  eq(st.rows.get("U1").items.length, 0, "ร่างหลัก (items) ว่างทันทีที่กดส่ง");
  // พิมพ์เพิ่มระหว่างกำลังส่ง → ต้องค้างเป็นร่างถัดไป ไม่หาย
  await svc.append("U1", [{ t: "text", text: "พิมพ์ระหว่างส่ง" }]);
  eq((await svc.claimSubmit("U1", { type: "consult" })).status, "busy", "ระหว่างกำลังส่ง กดซ้ำได้ busy");
  // createCase พัง → release → ร่างกลับมาครบ (ของเดิมก่อน + ที่พิมพ์ระหว่างส่ง)
  await svc.release("U1");
  const afterRelease = st.rows.get("U1");
  eq(afterRelease.items.length, 7, "createCase พังแล้วร่างไม่หาย (6 เดิม + 1 ระหว่างส่ง)");
  eq(afterRelease.items[0].text, "ข้อความ 0", "ลำดับเดิมอยู่ก่อน");
  eq(afterRelease.inflight, null, "release แล้วไม่มี inflight ค้าง");
  eq(afterRelease.submitted_at, null, "release แล้วกดส่งใหม่ได้");
  // ส่งสำเร็จ
  const c2 = await svc.claimSubmit("U1", { type: "complaint" });
  eq(c2.status, "claimed", "กดส่งใหม่หลัง release ได้");
  await svc.complete("U1", { caseNo: "LG-2569-000100", phone: "0812345678" });
  const done = st.rows.get("U1");
  ok(done.items.length === 0 && done.evidence_paths.length === 0 && done.inflight === null, "ส่งสำเร็จแล้วร่างว่าง");
  ok(done.submitted_at && done.last_case_no === "LG-2569-000100", "จำเลขที่เรื่องล่าสุด + submitted_at");
  eq((await svc.claimSubmit("U1", { type: "consult" })).status, "already", "กดปุ่มเดิมซ้ำหลังส่ง (ไม่มีข้อความใหม่) = already ไม่สร้างเรื่องซ้ำ");
  await svc.append("U1", [{ t: "text", text: "เรื่องใหม่" }]);
  eq(st.rows.get("U1").submitted_at, null, "ข้อความใหม่หลังส่ง = เปิดร่างใหม่");
  eq((await svc.claimSubmit("U1", { type: "consult" })).status, "claimed", "ร่างใหม่กดส่งได้");
  await svc.complete("U1", { caseNo: "LG-2569-000101" });

  // เตือนขอเบอร์ไม่เกิน 1 ครั้ง/10 นาที (จองสิทธิ์ด้วย CAS — สองข้อความพร้อมกันได้ครั้งเดียว)
  await svc.append("U2", [{ t: "text", text: "เรื่องของ U2" }]);
  await svc.setAwaitingPhone("U2", "appointment");
  ok(!(await svc.claimPhoneNudge("U2")), "เพิ่งขอเบอร์ไป ยังไม่เตือนซ้ำ");
  clock += PHONE_NUDGE_MS + 1000;
  const nudges = await Promise.all([svc.claimPhoneNudge("U2"), svc.claimPhoneNudge("U2")]);
  eq(nudges.filter(Boolean).length, 1, "ครบ 10 นาที เตือนได้ครั้งเดียวแม้ข้อความเข้าพร้อมกัน");
  eq(st.rows.get("U2").pending_type, "appointment", "จำประเภทเรื่องที่กดไว้ระหว่างรอเบอร์");

  // ยกเลิก → ลบไฟล์ของร่าง
  st.files.add("U3/chat/1-a.jpg");
  await svc.append("U3", [{ t: "text", text: "x" }, { t: "file", path: "U3/chat/1-a.jpg", kind: "image" }]);
  const cancelled = await svc.cancel("U3");
  ok(!cancelled.busy && st.rows.get("U3").items.length === 0, "ยกเลิกแล้วร่างว่าง");
  ok(st.deleted.includes("U3/chat/1-a.jpg"), "ยกเลิกแล้วลบไฟล์ของร่าง");

  // ร่างหมดอายุ (24 ชม.) → load แล้วล้าง + ลบไฟล์ · ⛔ ไฟล์ที่อยู่ในเรื่องแล้ว/ไม่ใช่ไฟล์แชตของคนนี้ ห้ามลบ
  await svc.append("U4", [{ t: "text", text: "ลืมกดส่ง" }, { t: "file", path: "U4/chat/1-x.jpg", kind: "image" }, { t: "file", path: "U4/chat/2-y.jpg", kind: "image" }, { t: "file", path: "U4/169-z.jpg", kind: "image" }]);
  st.cases.push({ uid: "U4", created_at: "2026-01-01T00:00:00Z", paths: ["U4/chat/2-y.jpg"] }); // ไฟล์นี้เข้าเรื่องไปแล้ว (จำลองเหตุผิดปกติ)
  clock += DRAFT_TTL_MS + 60 * 1000;
  const loaded = await svc.load("U4");
  ok(!hasSubstance(loaded.draft), "ร่างเกิน 24 ชม. ถูกล้างตอนโหลด");
  ok(st.deleted.includes("U4/chat/1-x.jpg"), "ไฟล์ของร่างหมดอายุถูกลบ");
  ok(!st.deleted.includes("U4/chat/2-y.jpg"), "⛔ ไฟล์ที่อยู่ในเรื่องแล้วห้ามลบ");
  ok(!st.deleted.includes("U4/169-z.jpg"), "⛔ ลบได้เฉพาะไฟล์ใต้ <uid>/chat/ (ไฟล์ฟอร์มเว็บไม่แตะ)");

  // ค้าง inflight (อินสแตนซ์ตายกลางทาง) → กู้: มีเรื่องเกิดแล้ว = ถือว่าส่งสำเร็จ · ไม่มี = คืนร่าง
  await svc.append("U5", [{ t: "text", text: "ส่งแล้วอินสแตนซ์ตาย" }]);
  const c5 = await svc.claimSubmit("U5", { type: "consult" });
  st.submissions.push({ submission_id: c5.claimed.submission_id, mode: "new", created_at: new Date(clock + 1000).toISOString(), case_no: "LG-2569-000555" });
  clock += STALE_INFLIGHT_MS + 5000;
  const l5 = (await svc.load("U5")).draft;
  ok(c5.status === "claimed" && l5.inflight === null && l5.last_case_no === "LG-2569-000555", "ค้าง inflight + มีเรื่องแล้ว → กู้เป็นส่งสำเร็จ (ไม่สร้างซ้ำ)");
  await svc.append("U6", [{ t: "text", text: "ส่งแล้วอินสแตนซ์ตายก่อนสร้างเรื่อง" }]);
  await svc.claimSubmit("U6", { type: "consult" });
  clock += STALE_INFLIGHT_MS + 5000;
  const l6 = (await svc.load("U6")).draft;
  ok(l6.inflight === null && l6.items.length === 1 && l6.submitted_at === null, "ค้าง inflight + ยังไม่มีเรื่อง → คืนร่างให้กดส่งใหม่ (ไม่หาย)");

  // purge (cron): ร่างค้าง 24 ชม. → ลบแถว+ไฟล์ · แถวส่งแล้ว > 2 วัน → ลบแถว ไม่แตะไฟล์ · ⛔ ไฟล์ในเรื่องไม่ถูกลบ
  const st2 = memStore();
  const svc2 = createChatIntake(st2, { now });
  await svc2.append("P1", [{ t: "text", text: "ร่างค้าง" }, { t: "file", path: "P1/chat/1-a.jpg", kind: "image" }]);
  await svc2.append("P2", [{ t: "text", text: "ส่งแล้ว" }, { t: "file", path: "P2/chat/1-b.jpg", kind: "image" }]);
  await svc2.claimSubmit("P2", { type: "consult" });
  st2.cases.push({ uid: "P2", created_at: new Date(clock).toISOString(), case_no: "LG-2569-000777", paths: ["P2/chat/1-b.jpg"] });
  await svc2.complete("P2", { caseNo: "LG-2569-000777" });
  await svc2.append("P3", [{ t: "text", text: "ยังสด" }, { t: "file", path: "P3/chat/1-c.jpg", kind: "image" }]);
  clock += DRAFT_TTL_MS - 60 * 1000;
  await svc2.append("P3", [{ t: "text", text: "ยังแก้อยู่" }]); // P3 แก้ก่อนครบ 24 ชม. → นับใหม่จากตอนนี้
  clock += 2 * 60 * 1000; // P1 เกิน 24 ชม. แล้ว · P3 เพิ่งแก้ 2 นาที
  let p = await svc2.purge();
  ok(!st2.rows.has("P1") && st2.deleted.includes("P1/chat/1-a.jpg"), "purge: ร่างค้างเกิน 24 ชม. ลบแถว+ไฟล์");
  ok(st2.rows.has("P2"), "purge: แถวที่ส่งแล้วยังไม่ถึง 2 วัน เก็บไว้ (ใช้ตอบ 'ส่งแล้ว')");
  ok(st2.rows.has("P3") && !st2.deleted.includes("P3/chat/1-c.jpg"), "purge: ร่างที่เพิ่งแก้ไม่ถูกลบ");
  clock += SUBMITTED_KEEP_MS;
  p = await svc2.purge();
  ok(!st2.rows.has("P2"), "purge: แถวที่ส่งแล้วเกิน 2 วัน ลบแถว");
  ok(!st2.deleted.includes("P2/chat/1-b.jpg"), "⛔ purge ไม่ลบไฟล์ที่ย้ายเข้าเรื่องแล้วเด็ดขาด");
  ok(p.submitted >= 1, "purge รายงานจำนวนแถวที่ลบ");
}

// ═══════════════════ 3) webhook ทั้งเส้น (ลายเซ็นจริง + fake LINE/Supabase/Storage) ═══════════════════
let evSeq = 0;
function sign(raw) { return crypto.createHmac("sha256", process.env.LINE_CHANNEL_SECRET).update(raw).digest("base64"); }
async function send(events) {
  const list = (Array.isArray(events) ? events : [events]).map((e) => ({
    webhookEventId: "ev" + ++evSeq, replyToken: "rt" + evSeq, timestamp: Date.now(), mode: "active", source: { type: "user", userId: UID }, ...e,
  }));
  const raw = Buffer.from(JSON.stringify({ destination: "Udest", events: list }));
  const req = Readable.from([raw]);
  req.method = "POST";
  req.headers = { "x-line-signature": sign(raw) };
  const res = { statusCode: 200, body: "", status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, setHeader() { return this; } };
  const before = fake.lineCalls.length;
  await webhook(req, res);
  const calls = fake.lineCalls.slice(before);
  return {
    status: res.statusCode,
    replies: calls.filter((c) => c.path === "/v2/bot/message/reply").map((c) => c.body),
    pushes: calls.filter((c) => c.path === "/v2/bot/message/push").map((c) => c.body),
    calls,
  };
}
const text = (t, extra = {}) => ({ type: "message", message: { id: "m" + evSeq, type: "text", text: t }, ...extra });
const postback = (data, extra = {}) => ({ type: "postback", postback: { data }, ...extra });
const msgsOf = (r) => r.replies.flatMap((b) => b.messages);
const alts = (r) => msgsOf(r).map((m) => m.altText || m.text || "");
const draftOf = (uid = UID) => fake.tables.chat_drafts.find((d) => d.line_uid === uid);
const json = (x) => JSON.stringify(x);

// ดัก log ทั้งหมดระหว่างเส้นทางประชาชน — ⛔ ห้ามมีข้อความ/ชื่อ/เบอร์ที่ประชาชนพิมพ์ (PDPA)
const logs = [];
const realLog = console.log, realError = console.error;
console.log = (...a) => logs.push(a.map((x) => (x instanceof Error ? x.stack : typeof x === "string" ? x : json(x))).join(" "));
console.error = (...a) => logs.push(a.map((x) => (x instanceof Error ? x.stack : typeof x === "string" ? x : json(x))).join(" "));
const STORY = "เพื่อนบ้านสร้างรั้วรุกล้ำเข้ามาในที่ดินของผมประมาณหนึ่งเมตร คุยกันแล้วไม่ยอมรื้อ อยากทราบว่าต้องทำอย่างไรต่อ";
try {
  // 3.1 ทักทาย/ขอบคุณ/สติกเกอร์ ไม่เข้าร่าง
  let r = await send(text("สวัสดีครับ"));
  eq(r.status, 200, "webhook ตอบ 200");
  ok(alts(r).some((a) => /สวัสดี/.test(a)), "ทักทายได้การ์ดทักทาย");
  r = await send(text("ขอบคุณครับ"));
  eq(r.replies.length, 0, "ขอบคุณ = เงียบ");
  r = await send({ type: "message", message: { id: "s1", type: "sticker", packageId: "1", stickerId: "1" } });
  eq(r.replies.length, 0, "สติกเกอร์ = เงียบ");
  ok(!draftOf() || !(draftOf().items || []).length, "ทักทาย/ขอบคุณ/สติกเกอร์ไม่เข้าร่าง");

  // 3.2 เล่าเรื่อง → เก็บเข้าร่าง + การ์ดรับเรื่อง (ครั้งเดียว) · ข้อความถัดไปเงียบแต่เก็บ
  r = await send(text(STORY));
  ok(alts(r).some((a) => a.startsWith("ได้รับข้อความแล้วค่ะ")), "เล่าเรื่อง → การ์ดรับเรื่อง");
  const offer = json(msgsOf(r));
  ok(offer.includes("lg:intake:consult") && offer.includes("lg:intake:complaint") && offer.includes("lg:intake:appointment"), "การ์ดรับเรื่องมีปุ่มส่ง 3 แบบ (จองคิวตามสวิตช์)");
  ok(offer.includes("ถือว่ายินยอมให้ศูนย์ฯ ใช้ข้อมูล"), "การ์ดรับเรื่องมีบรรทัด PDPA");
  ok(!/lg:intake:append/.test(offer), "ยังไม่มีเรื่องเดิม = ไม่มีปุ่มเพิ่มเข้าเรื่อง");
  eq(draftOf().items.length, 1, "ข้อความเล่าเรื่องเข้าร่าง");
  r = await send(text("ชื่อสมชาย ใจดี อยู่อำเภออู่ทองครับ"));
  eq(r.replies.length, 0, "ข้อความถัดไปเงียบ (ไม่แทรกการ์ดทุกประโยค)");
  eq(draftOf().items.length, 2, "แต่ยังเก็บเข้าร่าง");

  // 3.3 รูป → โหลดจากไลน์ ตรวจหัวไฟล์ อัปโหลด bucket evidence path "<uid>/chat/<ms>-<hex16>.jpg"
  r = await send({ type: "message", message: { id: "img1", type: "image", contentProvider: { type: "line" } } });
  const imgPath = draftOf().evidence_paths[0];
  ok(new RegExp(`^${UID}/chat/\\d{13}-[0-9a-f]{16}\\.jpg$`).test(imgPath || ""), `path รูปต้องเป็น <uid>/chat/<ms>-<hex16>.jpg (ได้ ${imgPath})`);
  ok(fake.storage.has(imgPath) && fake.storage.get(imgPath).equals(JPEG), "ไฟล์ขึ้น storage ครบทุกไบต์");
  ok(r.calls.some((c) => c.path === "/v2/bot/message/img1/content"), "โหลดเนื้อไฟล์จาก api-data.line.me");
  eq(r.replies.length, 0, "รูปหลังได้การ์ดไปแล้ว = เงียบ");
  // รูปจากลิงก์ภายนอก / ไฟล์ zip / วิดีโอ → โน้ต + บอกผู้ใช้ครั้งเดียว
  r = await send({ type: "message", message: { id: "zip1", type: "file", fileName: "หลักฐาน.zip", fileSize: 100 } });
  ok(msgsOf(r).some((m) => m.type === "text" && /เฉพาะรูปภาพ/.test(m.text)), "ไฟล์ชนิดไม่รับ → บอกผู้ใช้สั้นๆ");
  ok(!r.calls.some((c) => c.path.includes("zip1")), "ไฟล์นามสกุลไม่รับ ไม่ต้องโหลด");
  r = await send({ type: "message", message: { id: "vid1", type: "video", duration: 1000, contentProvider: { type: "line" } } });
  eq(r.replies.length, 0, "บอกเรื่องไฟล์ไม่รับไปแล้ว ครั้งต่อไปเงียบ (12 ชม.)");
  ok(draftOf().items.some((i) => i.t === "note" && /วิดีโอ/.test(i.text)), "วิดีโอ → โน้ตถึงเจ้าหน้าที่");
  r = await send({ type: "message", message: { id: "loc1", type: "location", title: "บ้าน", address: "อู่ทอง", latitude: 14.37, longitude: 99.89 } });
  ok(draftOf().items.some((i) => i.t === "location" && i.text.includes("https://www.google.com/maps?q=14.37,99.89")), "พิกัด → ข้อความ + ลิงก์แผนที่");

  // 3.4 ปุ่มเปิดคีย์บอร์ด = เงียบ ไม่โชว์กำลังพิมพ์
  r = await send(postback("lg:intake:type"));
  ok(r.replies.length === 0 && !r.calls.some((c) => c.path.includes("/chat/loading")), "lg:intake:type ไม่ตอบ + ไม่โชว์กำลังพิมพ์ค้าง");

  // 3.5 กดส่ง (ปรึกษา) → ไม่มีเบอร์ → ขอเบอร์ · พิมพ์อย่างอื่น = เก็บ เงียบ (เพิ่งขอไป) · พิมพ์เบอร์ = ได้เลขที่เรื่อง
  r = await send(postback("lg:intake:consult"));
  ok(alts(r).some((a) => /เบอร์โทรติดต่อกลับ/.test(a)), "ไม่มีเบอร์ → การ์ดขอเบอร์");
  const phoneCard = json(msgsOf(r));
  ok(phoneCard.includes("lg:intake:skipphone") && phoneCard.includes("lg:intake:cancel") && phoneCard.includes("openKeyboard"), "การ์ดขอเบอร์มีปุ่มข้าม/ยกเลิก/เปิดคีย์บอร์ด");
  eq(draftOf().awaiting, "phone", "ร่างอยู่ในสถานะรอเบอร์");
  r = await send(text("เขาสร้างรั้วตั้งแต่เดือนที่แล้วครับ"));
  eq(r.replies.length, 0, "ระหว่างรอเบอร์ พิมพ์อย่างอื่น = เก็บเงียบ (เตือนไม่เกิน 1 ครั้ง/10 นาที)");
  ok(draftOf().items.some((i) => i.text === "เขาสร้างรั้วตั้งแต่เดือนที่แล้วครับ"), "ข้อความระหว่างรอเบอร์ถูกเก็บ");
  const casesBefore = fake.tables.cases.length;
  const kwBefore = fake.tables.keyword_log.filter((k) => k.line_uid === UID && k.topic === "_fallback").length;
  ok(kwBefore >= 1, "มีแถวตัวกั้นการ์ดรับเรื่องของผู้ใช้นี้ก่อนส่ง");
  r = await send(text("เบอร์ 081-234-5678 ค่ะ"));
  eq(fake.tables.cases.length, casesBefore + 1, "พิมพ์เบอร์ → สร้างเรื่อง 1 เรื่อง");
  const c1 = fake.tables.cases.at(-1);
  eq(c1.source, "chat", "ช่องทาง source = chat");
  eq(c1.case_type, "consult", "ประเภทตามปุ่มที่กด");
  eq(c1.citizen_phone, "0812345678", "เบอร์ที่พิมพ์");
  eq(c1.citizen_name, "สมชาย ✨", "ชื่อจากโปรไฟล์ไลน์");
  eq(c1.citizen_line_uid, UID, "ผูก uid ไลน์ (เจ้าหน้าที่แจ้งผลเข้าแชตได้)");
  eq(c1.category, "land", "หมวดเดาจากข้อความ");
  ok(c1.pdpa_consent === true, "กดส่ง = ยินยอม PDPA");
  ok(c1.evidence_paths.length === 1 && c1.evidence_paths[0] === imgPath, "ไฟล์ในร่างย้ายเข้าเรื่อง");
  ok(c1.detail.includes(STORY) && c1.detail.includes("เขาสร้างรั้วตั้งแต่เดือนที่แล้วครับ") && /\[\d\d\/\d\d \d\d:\d\d\]/.test(c1.detail), "รายละเอียดรวมทุกข้อความพร้อมเวลา");
  ok(alts(r).some((a) => a === `รับเรื่องแล้ว เลขที่ ${c1.case_no}`), "ตอบ caseConfirmCard ด้วย reply");
  ok(json(msgsOf(r)).includes("0812345678"), "การ์ดยืนยันโชว์เบอร์ที่จะติดต่อกลับให้ผู้แจ้งตรวจ");
  ok(!r.pushes.some((p) => p.to === UID), "ยืนยันผู้แจ้งด้วย reply ไม่ใช่ push (ไม่กินโควตา)");
  ok(r.pushes.some((p) => p.to === STAFF_UID && json(p.messages).includes("💬 แจ้งทางแชตไลน์")), "แจ้งเจ้าหน้าที่ที่ผูกไลน์ พร้อมป้ายช่องทางแชต");
  ok(fake.tables.case_events.some((e) => e.case_id === c1.id && e.action === "created"), "ไทม์ไลน์ 'รับเรื่องเข้าระบบ'");
  const d1 = draftOf();
  ok(d1.items.length === 0 && d1.evidence_paths.length === 0 && d1.inflight === null && d1.last_case_no === c1.case_no, "ส่งแล้วร่างว่าง จำเลขที่เรื่อง");
  ok(fake.storage.has(imgPath), "⛔ ไฟล์ที่เข้าเรื่องแล้วยังอยู่ครบ");
  eq(fake.tables.keyword_log.filter((k) => k.line_uid === UID && k.topic === "_fallback").length, 0, "ส่งเรื่องแล้วล้างตัวกั้นการ์ดรับเรื่องของคนนี้");

  // 3.6 กดปุ่มเดิมซ้ำ = ตอบเลขเดิม ไม่สร้างใหม่
  r = await send(postback("lg:intake:consult"));
  eq(fake.tables.cases.length, casesBefore + 1, "กดส่งซ้ำหลังส่งแล้ว ไม่สร้างเรื่องซ้ำ");
  ok(alts(r).some((a) => a.includes(c1.case_no)), "ตอบเลขที่เรื่องเดิม");

  // 3.7 พิมพ์เพิ่มหลังส่ง → การ์ดรับเรื่องอีกครั้ง (มีปุ่มเพิ่มเข้าเรื่องเดิม) → กดเพิ่ม → ไทม์ไลน์ + แจ้งเจ้าหน้าที่
  r = await send(text("ลืมแจ้งว่ามีพยานเป็นผู้ใหญ่บ้านด้วยครับ"));
  ok(json(msgsOf(r)).includes(`lg:intake:append:${c1.case_no}`), "การ์ดรับเรื่องครั้งใหม่มีปุ่มเพิ่มข้อมูลเข้าเรื่องเดิม");
  await send({ type: "message", message: { id: "img2", type: "image", contentProvider: { type: "line" } } });
  r = await send(postback(`lg:intake:append:${c1.case_no}`));
  const ev = fake.tables.case_events.find((e) => e.case_id === c1.id && e.action === "citizen_message");
  ok(ev && ev.note.includes("ลืมแจ้งว่ามีพยาน") && ev.actor === "citizen", "ข้อความเพิ่มเติมลงไทม์ไลน์ citizen_message");
  eq(fake.tables.cases.find((c) => c.id === c1.id).evidence_paths.length, 2, "ไฟล์ใหม่เข้าเรื่องเดิม");
  ok(alts(r).some((a) => a.startsWith(`เพิ่มข้อมูลเข้าเรื่อง ${c1.case_no}`)), "ตอบการ์ดเพิ่มข้อมูลสำเร็จ");
  ok(r.pushes.some((p) => p.to === STAFF_UID && json(p.messages).includes(c1.case_no)), "แจ้งเจ้าหน้าที่ว่ามีข้อมูลเพิ่ม");
  eq(fake.tables.cases.length, casesBefore + 1, "เพิ่มเข้าเรื่องเดิม ไม่สร้างเรื่องใหม่");
  // คนอื่นกดเพิ่มเข้าเรื่องที่ไม่ใช่ของตัวเองไม่ได้
  r = await send(postback(`lg:intake:append:${c1.case_no}`, { source: { type: "user", userId: UID2 } }));
  ok(alts(r).some((a) => /ไม่พบ/.test(a)), "เพิ่มเข้าเรื่องของคนอื่น = ไม่พบเรื่อง");

  // 3.8 กดส่งพร้อมกัน 2 ครั้ง (สองอินสแตนซ์) → เรื่องเดียว
  await send(text("โดนโกงเงินจากการซื้อของออนไลน์ ติดต่อกลับเบอร์ 0899999999 ค่ะ"));
  const nBefore = fake.tables.cases.length;
  const [x1, x2] = await Promise.all([send(postback("lg:intake:complaint")), send(postback("lg:intake:complaint"))]);
  eq(fake.tables.cases.length, nBefore + 1, "กดส่งพร้อมกัน 2 ครั้ง = เรื่องเดียว");
  const cScam = fake.tables.cases.at(-1);
  ok(cScam.case_type === "complaint" && cScam.citizen_phone === "0899999999" && cScam.category === "scam", "มีเบอร์ในข้อความ = ส่งได้ทันทีไม่ต้องถามซ้ำ");
  ok([...alts(x1), ...alts(x2)].some((a) => a.startsWith("รับเรื่องแล้ว")), "ฝั่งที่ได้สิทธิ์ตอบยืนยัน");

  // 3.9 createCase พัง → ร่างไม่หาย + บอกให้กดใหม่
  await send(text("เรื่องทดสอบระบบล่ม ขอคำแนะนำเรื่องสัญญาเช่า"));
  fake.failNextCaseNo = true;
  const nb = fake.tables.cases.length;
  r = await send(postback("lg:intake:consult"));
  eq(fake.tables.cases.length, nb, "ระบบออกเลขไม่ได้ = ไม่มีเรื่อง");
  ok(alts(r).some((a) => /ข้อผิดพลาด|ขออภัย/.test(a)) && json(msgsOf(r)).includes("ยังไม่หาย"), "บอกผู้ใช้ว่าข้อความยังไม่หาย");
  ok(draftOf().items.some((i) => /สัญญาเช่า/.test(i.text || "")) && draftOf().inflight === null, "ร่างกลับมาครบ กดส่งใหม่ได้");
  r = await send(postback("lg:intake:consult"));
  eq(fake.tables.cases.length, nb + 1, "กดส่งอีกครั้งสำเร็จ");

  // 3.10 ขอนัดพบทนายอาสาจากแชต + ข้ามเบอร์ → ไม่มีวัน-เวลา ไม่พัง
  await send(text("ขอนัดพบทนายอาสาเรื่องแบ่งมรดกที่ดินของพ่อ พี่น้องตกลงกันไม่ได้ค่ะ"));
  r = await send(postback("lg:intake:appointment"));
  // พิมพ์เบอร์ไว้ในร่างก่อนหน้าแล้ว (0899999999 ถูกส่งไปกับเรื่องก่อน — ร่างใหม่ไม่มีเบอร์ในข้อความ) → ใช้เบอร์ล่าสุดที่จำไว้
  const cAppt = fake.tables.cases.at(-1);
  ok(cAppt.case_type === "appointment" && cAppt.preferred_date == null && cAppt.source === "chat", "จองคิวจากแชต preferred_date = null ไม่พัง");
  ok(json(msgsOf(r)).includes("โทรนัดวัน-เวลา"), "การ์ดยืนยันบอกว่าเจ้าหน้าที่จะโทรนัด");

  // 3.11 ข้ามเบอร์ (ผู้ใช้ใหม่ไม่เคยให้เบอร์) → ไม่มีเบอร์ + แจ้งความคืบหน้าผ่านแชต
  const send2 = (e) => send({ ...e, source: { type: "user", userId: UID2 } });
  await send2(text("อยากร้องเรียนเรื่องนายจ้างไม่จ่ายเงินเดือนมาสองเดือนแล้วค่ะ ทำงานโรงงานแถวสองพี่น้อง"));
  r = await send2(postback("lg:intake:complaint"));
  ok(alts(r).some((a) => /เบอร์/.test(a)), "ผู้ใช้ใหม่ไม่มีเบอร์ → ขอเบอร์");
  r = await send2(text("ไม่สะดวกให้เบอร์ค่ะ"));
  const cNoPhone = fake.tables.cases.at(-1);
  ok(cNoPhone.citizen_line_uid === UID2 && cNoPhone.citizen_phone == null && cNoPhone.category === "labor", "ข้ามเบอร์ได้ เรื่องเข้าระบบ");
  ok(json(msgsOf(r)).includes("ผ่านแชตนี้"), "ไม่มีเบอร์ → แจ้งว่าจะติดต่อ/แจ้งความคืบหน้าผ่านแชตนี้");
  ok(!/ตอบ(กลับ)?ในแชต/.test(json(msgsOf(r))), "⛔ ไม่สัญญาว่าจะมีคนตอบในแชต");

  // 3.12 ยกเลิก → ลบไฟล์ของร่าง
  await send2(text("เรื่องที่จะยกเลิก เล่ายาวพอสมควรเพื่อทดสอบการลบร่างและไฟล์"));
  await send2({ type: "message", message: { id: "img3", type: "image", contentProvider: { type: "line" } } });
  const p3 = draftOf(UID2).evidence_paths[0];
  ok(fake.storage.has(p3), "รูปของร่างอยู่ใน storage");
  r = await send2(postback("lg:intake:cancel"));
  ok(!fake.storage.has(p3) && draftOf(UID2).items.length === 0, "ยกเลิกแล้วลบไฟล์+ล้างร่าง");
  ok(msgsOf(r).some((m) => m.type === "text" && /ยกเลิกการส่งเรื่องแล้วค่ะ/.test(m.text)), "ตอบยืนยันการยกเลิก");

  // 3.13 ปุ่ม "💬 พิมพ์เล่าในแชตแทน" → การ์ดวิธีแจ้งเรื่อง
  r = await send2(postback("lg:chatintake"));
  ok(alts(r).some((a) => a.startsWith("วิธีแจ้งเรื่องทางแชต")), "lg:chatintake → การ์ดวิธีแจ้งเรื่องทางแชต");

  // 3.14 ยังไม่ขยาย check ของ source (migration-14 ครึ่งเดียว) → บันทึกเป็น line + ป้ายช่องทาง
  fake.chatCheck = false;
  await send2(text("ทดสอบกรณียังไม่ขยายเช็คช่องทาง ขอคำแนะนำเรื่องสัญญาจ้าง เบอร์ 0811111111"));
  r = await send2(postback("lg:intake:consult"));
  const cFallback = fake.tables.cases.at(-1);
  ok(cFallback.source === "line" && cFallback.detail.includes(CHAT_SOURCE_TAG), "check ไม่ผ่าน → source line + ป้าย [ช่องทาง: แจ้งทางแชตไลน์]");
  ok(alts(r).some((a) => a.startsWith("รับเรื่องแล้ว")), "ผู้ใช้ยังได้เลขที่เรื่องตามปกติ");
  fake.chatCheck = true;

  // 3.15 ยังไม่รัน migration-14 (ไม่มีตาราง chat_drafts) → พฤติกรรมเดิมทุกอย่าง
  fake.noChatTable = true;
  const UID3 = "U" + "e".repeat(32);
  const send3 = (e) => send({ ...e, source: { type: "user", userId: UID3 } });
  r = await send3(text(STORY));
  ok(alts(r).includes("ได้รับข้อความของท่านแล้ว"), "ไม่มีตาราง → การ์ดเดิม chatReceivedCard (ชี้ไปฟอร์ม)");
  const callsBefore = fake.lineCalls.length;
  r = await send3({ type: "message", message: { id: "img9", type: "image", contentProvider: { type: "line" } } });
  ok(!fake.lineCalls.slice(callsBefore).some((c) => c.path.includes("img9")), "ไม่มีตาราง → ไม่โหลดไฟล์จากไลน์");
  r = await send3(text("สวัสดีค่ะ"));
  ok(alts(r).some((a) => /สวัสดี/.test(a)), "ไม่มีตาราง → ทักทายยังทำงาน");
  r = await send3(text("LG-2569-999999"));
  ok(alts(r).some((a) => /ไม่พบ/.test(a)), "ไม่มีตาราง → ดูสถานะยังทำงาน");
  fake.noChatTable = false;

  // 3.16 ข้อความในกลุ่ม/ห้อง (ไม่ใช่แชต 1:1) ไม่เก็บเป็นร่างเรื่องของใคร
  const UID4 = "U" + "f".repeat(32);
  await send({ ...text(STORY), source: { type: "group", groupId: "C" + "1".repeat(32), userId: UID4 } });
  ok(!draftOf(UID4), "ข้อความในกลุ่มไม่สร้างร่างรับเรื่อง");
} finally {
  console.log = realLog;
  console.error = realError;
}
// ⛔ ไม่มีข้อความ/ชื่อ/เบอร์ของประชาชนใน log
for (const secret of ["0812345678", "081-234-5678", "0899999999", "สมชาย", "รุกล้ำ", "ผู้ใหญ่บ้าน", "นายจ้างไม่จ่าย", "สัญญาเช่า"]) {
  ok(!logs.some((l) => l.includes(secret)), `log ต้องไม่มีข้อมูลประชาชน: "${secret}"`);
}

// ═══════════════════ 4) store ของจริง (chatDraftStore) กับ fake PostgREST — purge ผ่าน DB ═══════════════════
{
  fake.tables.chat_drafts = [];
  const old = new Date(Date.now() - DRAFT_TTL_MS - 3600000).toISOString();
  fake.storage.set(`${UID}/chat/1-old.jpg`, JPEG);
  fake.storage.set(`${UID}/chat/2-incase.jpg`, JPEG);
  fake.tables.cases.push({ id: nextId++, case_no: "LG-2569-000999", citizen_line_uid: UID, evidence_paths: [`${UID}/chat/2-incase.jpg`], status: "new", created_at: old });
  fake.tables.chat_drafts.push({
    line_uid: UID, items: [{ t: "text", at: old, text: "ค้าง" }], evidence_paths: [`${UID}/chat/1-old.jpg`, `${UID}/chat/2-incase.jpg`],
    inflight: null, rev: 3, awaiting: null, pending_type: null, phone: null, last_case_no: null, submitted_at: null, phone_nudged_at: null, created_at: old, updated_at: old,
  });
  const out = await createChatIntake(chatDraftStore).purge();
  ok(out.drafts === 1 && !fake.tables.chat_drafts.length, "purge (DB จริงจำลอง) ลบแถวร่างค้าง");
  ok(!fake.storage.has(`${UID}/chat/1-old.jpg`), "purge ลบไฟล์ของร่าง");
  ok(fake.storage.has(`${UID}/chat/2-incase.jpg`), "⛔ purge ไม่ลบไฟล์ที่ถูกอ้างใน cases.evidence_paths");
}

// ═══════════════════ 5) หลังบ้าน + migration — ป้าย/ตัวกรองตรงกับ API (ข้อ 4 ของบอส "เจ้าหน้าที่ไม่เห็น") ═══════════════════
{
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../public/staff.html", import.meta.url), "utf8");
  ok(html.includes(`const CHAT_SOURCE_TAG = "${CHAT_SOURCE_TAG}"`), "staff.html ใช้ป้ายช่องทางแชตตัวเดียวกับ api/_cases.js (ยังไม่รัน migration-14 ก็เห็น)");
  ok(/c\.source === "chat"/.test(html), "staff.html ดู source = chat");
  for (const [val, lab] of [["consult", "ปรึกษา"], ["appointment", "จองคิว"], ["complaint", "ร้องเรียน"], ["chat", "แจ้งทางแชต"]]) {
    ok(new RegExp(`\\["${val}", "[^"]*${lab}"\\]`).test(html), `ชิปกรองประเภท ${lab}`);
  }
  ok(html.includes('citizen_message: "💬 ข้อความเพิ่มเติมจากประชาชน"'), "ไทม์ไลน์มีป้าย citizen_message");
  ok(html.includes("ยังไม่ระบุวัน — โทรนัด"), "จองคิวจากแชตไม่มีวัน แสดง 'ยังไม่ระบุวัน — โทรนัด'");
  ok(html.includes('id="typeChips"'), "มีแถวชิปกรองประเภทเหนือรายการ");
  const sql = readFileSync(new URL("../supabase-migration-14-chat-intake.sql", import.meta.url), "utf8");
  ok(/create table if not exists chat_drafts/.test(sql) && /alter table chat_drafts enable row level security/.test(sql), "migration-14: ตาราง chat_drafts + RLS");
  for (const col of ["items", "evidence_paths", "inflight", "rev", "awaiting", "pending_type", "phone", "last_case_no", "submitted_at", "phone_nudged_at", "updated_at"]) {
    ok(new RegExp(`\\n\\s+${col}\\s`).test(sql), `migration-14: คอลัมน์ ${col} (ตรงกับ DRAFT_COLS ใน _chatintake.js)`);
  }
  ok(/check \(source in \('line', 'web', 'chat'\)\)/.test(sql), "migration-14: cases.source รับ 'chat'");
  ok(!/drop table|delete from|truncate/i.test(sql), "migration-14 ไม่ลบข้อมูล (idempotent ปลอดภัย)");
}

console.log(`✅ test-chatintake.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
