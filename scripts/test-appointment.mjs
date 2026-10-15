/* scripts/test-appointment.mjs — แบบคำร้องขอเข้ารับคำปรึกษาทางกฎหมาย (เพิ่ม 30 ก.ย. 69)
   ใช้ได้ 2 ทาง: จากไลน์ (?k=) และจากเว็บ (ไม่มี ?k=) — ล็อกกันถอยหลังทุกมติบอส:
   - ชุดเวลา 09/10/11/13/14/15:00 · วัน = 14 วันทำการถัดไป · เซิร์ฟเวอร์ตรวจซ้ำทั้งวันและเวลา
   - ฟิลด์เท่าที่จำเป็น (ไม่มีเลขบัตร/อายุ/ที่อยู่เต็มหลุดเข้า DB)
   - โหมดมี/ไม่มีโทเคน · ฟอร์มอื่น (consult/complaint/add-evidence/upload-url) ยังบังคับโทเคน
   - กันสแปมโหมดเว็บ: honeypot / ตราเวลากรอกขั้นต่ำ / เพดานต่อ IP (แฮช HMAC ไม่มี IP ดิบ) / เพดานรวมรายวัน
   - บันทึกได้แม้ยังไม่รัน migration-12 (fallback ต่อท้ายรายละเอียด) · preferred_time_slot บันทึกคู่เสมอ
   - เรื่องที่ไม่มีไลน์ห้ามยิงไลน์ถึงประชาชน (form.js / staff.js) · สวิตช์ appointment_enabled ทั้งสองทาง
   ออฟไลน์ล้วน: ดัก globalThis.fetch จำลอง Supabase PostgREST + LINE API ในหน่วยความจำ ไม่มีการยิงเน็ตจริง
   (ห้ามยิงไลน์จริง — กฎข้อ 5 ของ CLAUDE.md) */
process.env.FORM_SECRET = "test-form-secret-ci-only";
process.env.STAFF_SECRET = "test-staff-secret-ci-only";
process.env.SUPABASE_URL = "http://fake-supabase.test";
process.env.SUPABASE_SERVICE_KEY = "fake-service-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN = "fake-line-token";
delete process.env.MAIL_USER;
delete process.env.MAIL_APP_PASSWORD;
delete process.env.APPT_WEB_DAILY_CAP;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }
function eq(a, b, msg) { assert.equal(a, b, msg); checked++; }

// ═══════════════════ จำลอง Supabase PostgREST + LINE API ═══════════════════
const STAFF_UID = "U" + "a".repeat(32);
const CITIZEN_UID = "U" + "b".repeat(32);
const fake = {
  migrated: true,
  seq: 0,
  tables: {
    cases: [],
    case_events: [],
    appointment_web_log: [],
    settings: [
      { key: "appointment_enabled", value: true },
      { key: "phone", value: "0 3552 5500" },
      { key: "responder_label", value: "เจ้าหน้าที่" },
    ],
    staff: [{
      id: 1, role: "admin", active: true, display_name: "ผู้ทดสอบ", approved_at: "2026-09-01T00:00:00Z",
      line_uid: STAFF_UID, email: "staff@example.test", notify_line: true, notify_email: true, notify_categories: null,
    }],
  },
  lineCalls: [],
  caseInserts: [], // ทุกครั้งที่มีคนพยายาม insert เข้า cases (รวมรอบที่ล้มเพราะไม่มีคอลัมน์)
};
const NEW_CASE_COLS = ["preferred_time", "source", "citizen_district"];
let nextId = 1;

function jsonRes(status, body, headers = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
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
  if (op === "in") return arg.replace(/^\(|\)$/g, "").split(",").includes(String(v));
  if (op === "not") return !matchFilter(row, key, arg);
  throw new Error("fake postgrest: ไม่รองรับ operator " + raw);
}
const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);
function filtered(table, sp) {
  return table.filter((row) => [...sp.entries()].every(([k, v]) => RESERVED.has(k) || matchFilter(row, k, v)));
}

globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers || {});
  const bodyText = init.body ? String(init.body) : "";

  if (u.host === "api.line.me") {
    fake.lineCalls.push({ path: u.pathname, body: bodyText ? JSON.parse(bodyText) : null });
    if (u.pathname.endsWith("/message/quota")) return jsonRes(200, { type: "limited", value: 300 });
    if (u.pathname.endsWith("/message/quota/consumption")) return jsonRes(200, { totalUsage: 0 });
    return jsonRes(200, {});
  }
  if (u.host !== "fake-supabase.test") throw new Error("ห้ามยิงเน็ตจริงในเทสต์: " + u.href);

  const path = u.pathname.replace(/^\/rest\/v1\//, "");
  if (path === "rpc/next_case_no") return jsonRes(200, `LG-2569-${String(++fake.seq).padStart(6, "0")}`);

  const name = path;
  if (name === "appointment_web_log" && !fake.migrated) {
    return jsonRes(404, { code: "PGRST205", message: "Could not find the table 'public.appointment_web_log' in the schema cache" });
  }
  const table = fake.tables[name];
  if (!table) return jsonRes(404, { code: "PGRST205", message: `Could not find the table 'public.${name}' in the schema cache` });
  const wantObject = (headers.get("Accept") || "").includes("vnd.pgrst.object");
  const prefer = headers.get("Prefer") || "";
  const reply = (rows, status = 200) => {
    const extra = /count=exact/.test(prefer) ? { "Content-Range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } : {};
    if (method === "HEAD") return new Response(null, { status, headers: extra });
    if (wantObject) {
      if (rows.length !== 1) return jsonRes(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return jsonRes(status, rows[0], extra);
    }
    return jsonRes(status, rows, extra);
  };

  if (method === "GET" || method === "HEAD") {
    let rows = filtered(table, u.searchParams);
    const countRows = rows;
    const limit = Number(u.searchParams.get("limit"));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    if (/count=exact/.test(prefer)) {
      const res = reply(rows);
      res.headers.set("Content-Range", `0-${Math.max(0, rows.length - 1)}/${countRows.length}`);
      return res;
    }
    return reply(rows);
  }
  if (method === "POST") {
    const incoming = JSON.parse(bodyText);
    const list = Array.isArray(incoming) ? incoming : [incoming];
    if (name === "cases") {
      for (const r of list) fake.caseInserts.push({ ...r });
      if (!fake.migrated && list.some((r) => NEW_CASE_COLS.some((c) => c in r))) {
        const col = NEW_CASE_COLS.find((c) => list.some((r) => c in r));
        return jsonRes(400, { code: "PGRST204", message: `Could not find the '${col}' column of 'cases' in the schema cache` });
      }
    }
    const out = [];
    for (const r of list) {
      if (/resolution=merge-duplicates/.test(prefer) && name === "settings") {
        const i = table.findIndex((x) => x.key === r.key);
        if (i >= 0) { table[i] = { ...table[i], ...r }; out.push(table[i]); continue; }
      }
      const row = { id: nextId++, created_at: new Date().toISOString(), ...r };
      if (name === "cases") {
        row.status = row.status || "new";
        row.updated_at = row.created_at;
        if (fake.migrated && !("source" in row)) row.source = "line"; // default ของ migration-12
      }
      table.push(row);
      out.push(row);
    }
    return /return=representation/.test(prefer) ? reply(out, 201) : new Response(null, { status: 201 });
  }
  if (method === "PATCH") {
    const patch = JSON.parse(bodyText);
    const rows = filtered(table, u.searchParams);
    for (const r of rows) Object.assign(r, patch);
    return /return=representation/.test(prefer) ? reply(rows) : new Response(null, { status: 204 });
  }
  if (method === "DELETE") {
    const rows = filtered(table, u.searchParams);
    fake.tables[name] = table.filter((r) => !rows.includes(r));
    return new Response(null, { status: 204 });
  }
  throw new Error("fake postgrest: ไม่รองรับ " + method);
};

// ═══════════════════ โหลดโค้ดจริงหลังดัก fetch แล้ว ═══════════════════
const { default: formHandler } = await import("../api/form.js");
const staffMod = await import("../api/staff.js");
const staffHandler = staffMod.default;
const { toCsv, csvEscape } = staffMod;
const { setSetting } = await import("../api/_settings.js");
const { makeFormToken, makeWebFormStamp, readWebFormStamp, resolveFormAuth, ipDayHash } = await import("../api/_formauth.js");
const { makeSessionToken, COOKIE_NAME } = await import("../api/_staffauth.js");
const {
  insertCaseWithFallback, isMissingColumnError, citizenLineTarget, apptFallbackNote, missingColumnName, missingColumnLogText,
} = await import("../api/_cases.js");
const {
  APPT_TIMES, DISTRICTS, TITLES, CATEGORY_OPTIONS, FIELD_LIMITS, WEB_LIMITS, allowedApptDates, bkkTodayIso,
  thaiDateLabel, timeSlotOf, validateAppointment, webQuotaVerdict, normalizePhone,
} = await import("../api/_appointment.js");
const { caseNotifyMailText } = await import("../api/_mailer.js");

// ─── ตัวช่วยเรียก handler แบบ Vercel (req เป็น stream, res มี status/setHeader/send) ───
let ipSeq = 10;
const freshIp = () => `198.51.100.${ipSeq++}`;
function makeReq({ method = "POST", url = "/api/form", body, ip, cookie }) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = { "x-forwarded-for": ip || freshIp(), ...(cookie ? { cookie } : {}) };
  req.query = Object.fromEntries(new URL(url, "http://x").searchParams);
  return req;
}
async function call(handler, opts) {
  const res = {
    statusCode: 200, headers: {}, body: "",
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    send(b) { this.body = b; return this; },
  };
  await handler(makeReq(opts), res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, json, body: res.body };
}
const pushesTo = () => fake.lineCalls.filter((c) => c.path.endsWith("/message/push")).map((c) => c.body.to);
function resetCalls() { fake.lineCalls = []; fake.caseInserts = []; }

// ═══════════════════ 1) ชุดวัน/เวลาที่อนุญาต (ออฟไลน์ล้วน) ═══════════════════
eq(APPT_TIMES.join(","), "09:00,10:00,11:00,13:00,14:00,15:00", "เวลาต้องเป็นรายชั่วโมงเว้นพักเที่ยงตามมติบอส");
ok(!APPT_TIMES.includes("12:00"), "ห้ามมี 12:00 (พักเที่ยง)");
eq(timeSlotOf("11:00"), "morning", "ก่อนเที่ยง = morning");
eq(timeSlotOf("13:00"), "afternoon", "บ่าย = afternoon");
eq(DISTRICTS.length, 11, "10 อำเภอ + นอกจังหวัด");
ok(DISTRICTS.includes("หนองหญ้าไซ") && DISTRICTS.includes("นอกจังหวัด"), "มีอำเภอครบ + นอกจังหวัด");
eq(TITLES.join(","), "นาย,นาง,นางสาว,อื่นๆ", "คำนำหน้าตามมติ");
eq(CATEGORY_OPTIONS.map((c) => c.value).join(","), "scam,debt,inheritance,labor,divorce,land,criminal,other", "หมวดเรื่องตามหมวดเดิมของระบบ");
{
  const staffHtml = readFileSync(new URL("../public/staff.html", import.meta.url), "utf8");
  for (const c of CATEGORY_OPTIONS) ok(staffHtml.includes(`${c.value}:`), `หมวด ${c.value} ต้องมีป้ายในหลังบ้านด้วย`);
}
eq(bkkTodayIso(new Date("2026-09-30T18:30:00Z")), "2026-10-01", "01:30 น. เวลาไทย ต้องนับเป็นวันใหม่แล้ว (ไม่ใช่วันตาม UTC)");
eq(bkkTodayIso(new Date("2026-09-30T16:59:00Z")), "2026-09-30", "23:59 น. เวลาไทย ยังเป็นวันเดิม");
{
  const d = allowedApptDates("2026-09-30", []);
  eq(d.length, 14, "ต้องได้ 14 วันทำการ");
  eq(d[0].iso, "2026-10-01", "เริ่มพรุ่งนี้ ไม่ใช่วันนี้");
  eq(d[0].label, "พฤหัสบดี 1 ต.ค. 2569", "ป้ายวันเป็นภาษาไทย พ.ศ. และตรงกับวันจริง (บั๊กเดิม: ค่ากับป้ายเลื่อนกัน 1 วัน)");
  ok(d.every((x) => ![0, 6].includes(new Date(x.iso + "T00:00:00Z").getUTCDay())), "ต้องไม่มีเสาร์-อาทิตย์");
  eq(d[13].iso, "2026-10-20", "วันทำการที่ 14 นับจาก 30 ก.ย. 69 = 20 ต.ค. 69");
  const h = allowedApptDates("2026-09-30", ["2026-10-13"]);
  ok(!h.some((x) => x.iso === "2026-10-13"), "ข้ามวันหยุดใน settings.holidays");
  eq(h[13].iso, "2026-10-21", "ข้ามวันหยุดแล้วยังได้ครบ 14 วัน");
  eq(thaiDateLabel("2026-02-31"), "2026-02-31", "วันที่ไม่มีจริงต้องไม่ถูกเลื่อนเงียบๆ");
}

// ═══════════════════ 2) ตรวจฟิลด์ (validateAppointment) ═══════════════════
const TODAY = "2026-09-30";
const good = () => ({
  title: "นาย", firstName: "สมชาย", lastName: "ใจดี", phone: "081-234-5678", district: "อู่ทอง",
  preferredDate: "2026-10-01", preferredTime: "10:00", category: "debt", detail: "ถูกทวงหนี้บัตรเครดิต", pdpaConsent: true,
});
{
  const r = validateAppointment(good(), { todayIso: TODAY });
  ok(r.ok, "ข้อมูลครบต้องผ่าน");
  eq(r.value.citizenName, "นายสมชาย ใจดี", "คำนำหน้าต่อชื่อแบบฟอร์มราชการ");
  eq(r.value.phone, "0812345678", "เบอร์ตัดขีดออก");
  eq(r.value.preferredTimeSlot, "morning", "10:00 → slot morning (บันทึกคู่เสมอ)");
  const withPii = validateAppointment({ ...good(), idCard: "1234567890123", age: 40, address: "99 ม.1 ต.ท่าพี่เลี้ยง" }, { todayIso: TODAY });
  ok(withPii.ok, "ช่องเกินที่ใครยิงมาไม่ทำให้ล้ม");
  const keys = Object.keys(withPii.value).sort().join(",");
  eq(keys, "category,citizenName,detail,district,phone,preferredDate,preferredTime,preferredTimeSlot", "คืนเฉพาะฟิลด์ที่อนุญาต — ไม่มีเลขบัตร/อายุ/ที่อยู่");
  const other = validateAppointment({ ...good(), title: "อื่นๆ", titleOther: "ว่าที่ ร.ต." }, { todayIso: TODAY });
  eq(other.value.citizenName, "ว่าที่ ร.ต. สมชาย ใจดี", "คำนำหน้าอื่นๆ ใช้ค่าที่ระบุ");
  const bad = (patch, field, why) => {
    const x = validateAppointment({ ...good(), ...patch }, { todayIso: TODAY });
    ok(!x.ok && x.field === field, `${why} (ได้ field=${x.field})`);
  };
  bad({ title: "" }, "title", "ไม่เลือกคำนำหน้าต้องไม่ผ่าน");
  bad({ title: "ดร." }, "title", "คำนำหน้านอกรายการต้องไม่ผ่าน");
  bad({ title: "อื่นๆ", titleOther: "" }, "titleOther", "เลือกอื่นๆ แต่ไม่ระบุต้องไม่ผ่าน");
  bad({ titleOther: "x".repeat(99), title: "อื่นๆ" }, "titleOther", "คำนำหน้ายาวเกินต้องไม่ผ่าน");
  bad({ firstName: " " }, "firstName", "ชื่อว่างต้องไม่ผ่าน");
  bad({ firstName: "ก".repeat(FIELD_LIMITS.firstName + 1) }, "firstName", "ชื่อยาวเกินต้องไม่ผ่าน");
  bad({ lastName: "ก".repeat(FIELD_LIMITS.lastName + 1) }, "lastName", "นามสกุลยาวเกินต้องไม่ผ่าน");
  bad({ phone: "12345" }, "phone", "เบอร์ผิดรูปแบบต้องไม่ผ่าน");
  bad({ phone: "0".repeat(40) }, "phone", "เบอร์ยาวเกินต้องไม่ผ่าน");
  bad({ district: "บางเลน" }, "district", "อำเภอนอกรายการต้องไม่ผ่าน");
  bad({ preferredDate: "2026-09-30" }, "preferredDate", "วันนี้ต้องไม่ผ่าน (ต้องล่วงหน้า)");
  bad({ preferredDate: "2026-10-03" }, "preferredDate", "วันเสาร์ต้องไม่ผ่าน");
  bad({ preferredDate: "2026-10-21" }, "preferredDate", "เกิน 14 วันทำการต้องไม่ผ่าน");
  bad({ preferredDate: "2026-10-01T00:00" }, "preferredDate", "รูปแบบวันผิดต้องไม่ผ่าน");
  bad({ preferredTime: "12:00" }, "preferredTime", "12:00 (พักเที่ยง) ต้องไม่ผ่าน");
  bad({ preferredTime: "08:00" }, "preferredTime", "08:00 ต้องไม่ผ่าน");
  bad({ preferredTime: "16:00" }, "preferredTime", "16:00 ต้องไม่ผ่าน");
  bad({ category: "tax" }, "category", "หมวดนอกรายการต้องไม่ผ่าน");
  bad({ detail: "" }, "detail", "รายละเอียดว่างต้องไม่ผ่าน");
  bad({ detail: "ก".repeat(FIELD_LIMITS.detail + 1) }, "detail", "รายละเอียดยาวเกินต้องไม่ผ่าน");
  bad({ pdpaConsent: "true" }, "pdpa", "PDPA ต้องเป็น true จริง ไม่ใช่สตริง");
  ok(!validateAppointment({ ...good(), preferredDate: "2026-10-13" }, { todayIso: TODAY, holidays: ["2026-10-13"] }).ok, "วันหยุดราชการต้องไม่ผ่าน");
  eq(normalizePhone("+66812345678"), "0812345678", "+66 แปลงเป็น 0");
  eq(normalizePhone("035525500"), "035525500", "เบอร์บ้าน 9 หลักผ่าน");
}

// ═══════════════════ 3) โหมดมี/ไม่มีโทเคน + ตราเวลา + แฮช IP ═══════════════════
{
  const web = resolveFormAuth({ formType: "appointment" });
  ok(web.ok && web.web && web.uid === null, "appointment ไม่มี k = โหมดเว็บ uid null");
  for (const ft of ["consult", "complaint", "addevidence", undefined]) {
    ok(!resolveFormAuth({ formType: ft }).ok, `formType ${ft} ไม่มี k ต้องไม่ผ่าน (ยังบังคับลิงก์จากไลน์)`);
  }
  ok(!resolveFormAuth({ formType: "appointment", k: "a.b.c.d" }).ok, "มี k แต่ปลอม = ปฏิเสธ ห้ามถอยไปโหมดเว็บเงียบๆ");
  const line = resolveFormAuth({ formType: "appointment", k: makeFormToken(CITIZEN_UID, "appointment") });
  ok(line.ok && !line.web && line.uid === CITIZEN_UID, "มี k ถูกต้อง = โหมดไลน์ผูก uid");
  ok(!resolveFormAuth({ formType: "appointment", k: makeFormToken(CITIZEN_UID, "consult") }).ok, "ลิงก์ฟอร์มปรึกษาใช้ยื่นแบบคำร้องนี้ไม่ได้");

  const now = Date.now();
  ok(readWebFormStamp(makeWebFormStamp(now - 5000), { now }).ok, "กรอก 5 วินาที ผ่าน");
  eq(readWebFormStamp(makeWebFormStamp(now - 1000), { now }).code, "too_fast", "กรอก 1 วินาที = เร็วเกิน (บอท)");
  eq(readWebFormStamp(makeWebFormStamp(now - 7 * 3600e3), { now }).code, "stamp_expired", "ตราเวลาเก่าเกิน 6 ชม. ต้องไม่ผ่าน");
  const st = makeWebFormStamp(now - 60000).split(".");
  eq(readWebFormStamp(`w.${now - 3600e3}.${st[2]}`, { now }).code, "stamp_bad", "แก้เวลาในตราเองโดยไม่มีลายเซ็นใหม่ต้องไม่ผ่าน");
  eq(readWebFormStamp("", { now }).code, "stamp_bad", "ไม่มีตราเวลาต้องไม่ผ่าน");
  eq(readWebFormStamp(makeFormToken(CITIZEN_UID, "appointment"), { now }).code, "stamp_bad", "เอาโทเคนฟอร์มมาใช้แทนตราเวลาไม่ได้");

  const h1 = ipDayHash("203.0.113.9", "2026-09-30");
  ok(/^[0-9a-f]{64}$/.test(h1), "แฮช IP เป็น HMAC-SHA256 hex");
  ok(!h1.includes("203"), "แฮชต้องไม่มี IP ดิบ");
  eq(h1, ipDayHash("203.0.113.9", "2026-09-30"), "IP+วันเดียวกันได้แฮชเดิม (นับเพดานได้)");
  ok(h1 !== ipDayHash("203.0.113.9", "2026-10-01"), "ข้ามวันแฮชเปลี่ยน (โยงข้ามวันไม่ได้)");

  ok(webQuotaVerdict({ ipHour: 2, ipDay: 9, globalDay: 29 }).ok, "ต่ำกว่าเพดานต้องผ่าน");
  eq(webQuotaVerdict({ ipHour: WEB_LIMITS.perIpHour }).code, "web_ip_limit", "ครบเพดานต่อชั่วโมง");
  eq(webQuotaVerdict({ ipDay: WEB_LIMITS.perIpDay }).code, "web_ip_limit", "ครบเพดานต่อวันต่อ IP");
  eq(webQuotaVerdict({ globalDay: WEB_LIMITS.globalDay }).code, "web_daily_cap", "ครบเพดานรวมรายวัน");
  ok(/0 3552 5500/.test(webQuotaVerdict({ globalDay: 99 }, WEB_LIMITS, "0 3552 5500").error), "เกินเพดาน = ข้อความสุภาพชวนโทรศูนย์พร้อมเบอร์");
}

// ═══════════════════ 4) fallback ตอนยังไม่รัน migration-12 (ตัวบันทึกล้วน) ═══════════════════
{
  const seen = [];
  const noCols = async (row) => {
    seen.push(row);
    return NEW_CASE_COLS.some((c) => c in row)
      ? { data: null, error: { code: "PGRST204", message: "Could not find the 'preferred_time' column of 'cases' in the schema cache" } }
      : { data: { id: 1, ...row }, error: null };
  };
  const extras = { preferred_time: "14:00", source: "web", citizen_district: "อู่ทอง" };
  const note = apptFallbackNote({ preferredTime: "14:00", citizenDistrict: "อู่ทอง", source: "web" });
  const r = await insertCaseWithFallback(noCols, { detail: "ปรึกษาเรื่องที่ดิน", preferred_time_slot: "afternoon" }, extras, note);
  ok(!r.error && r.usedFallback, "ไม่มีคอลัมน์ใหม่ → บันทึกรอบสองสำเร็จ");
  eq(seen.length, 2, "ลอง 2 รอบพอดี");
  ok(!NEW_CASE_COLS.some((c) => c in seen[1]), "รอบสองต้องไม่มีคอลัมน์ใหม่");
  ok(seen[1].detail.includes("เวลาที่สะดวก 14:00 น.") && seen[1].detail.includes("อู่ทอง") && seen[1].detail.includes("ยื่นผ่านเว็บไซต์"), "ข้อมูลใหม่ต่อท้ายรายละเอียดแทน");
  eq(seen[1].preferred_time_slot, "afternoon", "preferred_time_slot ยังบันทึกคู่เสมอ");
  const other = async () => ({ data: null, error: { code: "23502", message: 'null value in column "detail" violates not-null constraint' } });
  const r2 = await insertCaseWithFallback(other, { detail: null }, extras, note);
  ok(r2.error && !r2.usedFallback, "error อื่นที่ไม่ใช่ 'ไม่มีคอลัมน์' ต้องไม่ถูกกลืน");
  ok(!isMissingColumnError({ code: "23514", message: 'violates check constraint "cases_source_check"' }), "check constraint ไม่ใช่ missing column");
  ok(isMissingColumnError({ code: "42703", message: 'column "source" does not exist' }), "42703 = missing column");
  // 5 ต.ค. 69: log ต้องบอกคอลัมน์ที่หายจริง — ขาด submission_id ไม่ใช่ "ยังไม่รัน migration-12"
  const subErr = { code: "PGRST204", message: "Could not find the 'submission_id' column of 'cases' in the schema cache" };
  eq(missingColumnName(subErr), "submission_id", "อ่านชื่อคอลัมน์จาก PGRST204");
  eq(missingColumnName({ code: "42703", message: 'column "citizen_district" of relation "cases" does not exist' }), "citizen_district", "อ่านชื่อคอลัมน์จาก 42703");
  ok(/submission_id/.test(missingColumnLogText(subErr, extras)) && /migration-15/.test(missingColumnLogText(subErr, extras)) && !/migration-12/.test(missingColumnLogText(subErr, extras)), "log ขาด submission_id ชี้ migration-15 ไม่ใช่ migration-12");
  ok(/preferred_time/.test(missingColumnLogText({ code: "PGRST204", message: "Could not find the 'preferred_time' column of 'cases' in the schema cache" }, extras)) && /migration-12/.test(missingColumnLogText({ code: "PGRST204", message: "Could not find the 'preferred_time' column of 'cases' in the schema cache" }, extras)), "log ขาด preferred_time ชี้ migration-12");
}

// ═══════════════════ 5) กัน null uid ═══════════════════
eq(citizenLineTarget({ citizen_line_uid: null }), null, "uid null = ห้ามยิง");
eq(citizenLineTarget({ citizen_line_uid: "" }), null, "uid ว่าง = ห้ามยิง");
eq(citizenLineTarget({}), null, "ไม่มีคีย์ = ห้ามยิง");
eq(citizenLineTarget(null), null, "row null = ห้ามยิง");
eq(citizenLineTarget({ citizen_line_uid: "null" }), null, "สตริง 'null' = ห้ามยิง");
eq(citizenLineTarget({ citizen_line_uid: CITIZEN_UID }), CITIZEN_UID, "uid ไลน์จริงผ่าน");
{
  // ล็อกทุกไฟล์ในขอบเขต: ห้ามกลับไปยิง push ด้วย uid ดิบจากแถวเรื่อง/โทเคนโดยไม่ผ่านด่าน citizenLineTarget()
  for (const f of ["form.js", "staff.js", "cron-notify.js", "_cases.js"]) {
    const src = readFileSync(new URL(`../api/${f}`, import.meta.url), "utf8");
    ok(!/push\(\s*(row|caseRow|updated|c)\.citizen_line_uid/.test(src), `${f}: ห้าม push(...citizen_line_uid) ตรงๆ`);
    ok(!/push\(\s*read\.uid/.test(src), `${f}: ห้าม push(read.uid) ตรงๆ`);
  }
}

// ═══════════════════ 6) ทั้งเส้นทางผ่าน handler จริง (fake DB/LINE) ═══════════════════
const webBody = (patch = {}) => ({
  formType: "appointment", stamp: makeWebFormStamp(Date.now() - 10000), honeypot: "",
  ...good(), preferredDate: allowedApptDates(bkkTodayIso(), [])[0].iso, ...patch,
});

// 6.1 appt-config
{
  const r = await call(formHandler, { method: "GET", url: "/api/form?action=appt-config" });
  ok(r.status === 200 && r.json.ok && r.json.enabled, "appt-config ตอบ enabled");
  eq(r.json.dates.length, 14, "appt-config ให้ 14 วัน");
  eq(r.json.times.join(","), APPT_TIMES.join(","), "appt-config ให้ชุดเวลาเดียวกับเซิร์ฟเวอร์");
  ok(readWebFormStamp(r.json.stamp, { now: Date.now() + 5000 }).ok, "appt-config ออกตราเวลาที่ใช้ได้");
}

// 6.2 โหมดเว็บ (migration-12 รันแล้ว) — บันทึกได้ uid null, ไม่ยิงไลน์ถึงประชาชน, แจ้งเจ้าหน้าที่
{
  resetCalls();
  const r = await call(formHandler, { body: webBody({ preferredTime: "14:00", idCard: "1234567890123", age: 50, address: "บ้านเลขที่ 1" }) });
  ok(r.status === 200 && r.json.ok, "ยื่นโหมดเว็บสำเร็จ: " + r.body);
  ok(/^LG-2569-\d{6}$/.test(r.json.caseNo), "ได้เลขที่เรื่อง");
  eq(r.json.channel, "web", "ช่องทาง web");
  eq(r.json.confirmSent, false, "ไม่มีการ์ดยืนยันทางไลน์");
  const row = fake.tables.cases.find((c) => c.case_no === r.json.caseNo);
  eq(row.citizen_line_uid, null, "citizen_line_uid = null");
  eq(row.case_type, "appointment", "case_type appointment");
  eq(row.source, "web", "source = web");
  eq(row.preferred_time, "14:00", "บันทึกเวลา HH:MM");
  eq(row.preferred_time_slot, "afternoon", "preferred_time_slot บันทึกคู่");
  eq(row.citizen_district, "อู่ทอง", "บันทึกอำเภอ");
  eq(row.citizen_name, "นายสมชาย ใจดี", "ชื่อรวมคำนำหน้า");
  ok(!("id_card" in row) && !("idCard" in row) && !("age" in row) && !("address" in row), "ไม่มีเลขบัตร/อายุ/ที่อยู่ในแถว");
  ok(!JSON.stringify(row).includes("1234567890123"), "เลขบัตรที่แอบส่งมาต้องไม่หลุดเข้า DB");
  eq(fake.tables.appointment_web_log.length, 1, "บันทึกการยื่นผ่านเว็บ 1 แถว");
  const logRow = fake.tables.appointment_web_log[0];
  ok(/^[0-9a-f]{64}$/.test(logRow.ip_hash) && !JSON.stringify(logRow).includes("198.51.100"), "ตารางบันทึกเก็บแค่แฮช ไม่มี IP ดิบ");
  const to = pushesTo();
  ok(to.length >= 1 && to.every((u) => u === STAFF_UID), "push ไปเฉพาะเจ้าหน้าที่ ไม่ยิงถึงประชาชน/ไม่ยิง to=null: " + JSON.stringify(to));
  const staffMsg = fake.lineCalls.find((c) => c.path.endsWith("/message/push"))?.body.messages[0].text || "";
  ok(staffMsg.includes("14:00 น.") && staffMsg.includes("ยื่นผ่านเว็บ"), "ข้อความแจ้งเจ้าหน้าที่บอกเวลาและช่องทางเว็บ");
  ok(fake.tables.case_events.some((e) => e.action === "created"), "มี case_event created");
}

// 6.3 โหมดไลน์ (?k=) — ผูก uid + ส่งการ์ดยืนยันเข้าไลน์เหมือนเดิม
{
  resetCalls();
  const k = makeFormToken(CITIZEN_UID, "appointment");
  const body = { ...webBody(), stamp: undefined, k };
  const r = await call(formHandler, { body });
  ok(r.status === 200 && r.json.ok, "ยื่นโหมดไลน์สำเร็จ: " + r.body);
  eq(r.json.channel, "line", "ช่องทาง line");
  const row = fake.tables.cases.find((c) => c.case_no === r.json.caseNo);
  eq(row.citizen_line_uid, CITIZEN_UID, "ผูก citizen_line_uid");
  eq(row.source, "line", "source = line");
  const confirm = fake.lineCalls.find((c) => c.path.endsWith("/message/push") && c.body.to === CITIZEN_UID);
  ok(confirm && confirm.body.messages[0].type === "flex", "ส่งการ์ดยืนยัน (flex) เข้าไลน์ผู้ยื่น");
  ok(JSON.stringify(confirm.body).includes(r.json.caseNo), "การ์ดยืนยันมีเลขที่เรื่อง");
  eq(r.json.confirmSent, true, "confirmSent = true");
  const noLog = fake.tables.appointment_web_log.length;
  eq(noLog, 1, "โหมดไลน์ไม่นับเพดานเว็บ");
}

// 6.4 ฟอร์มอื่นยังบังคับโทเคน
{
  resetCalls();
  const before = fake.tables.cases.length;
  const c1 = await call(formHandler, { body: { formType: "consult", name: "ก", phone: "0812345678", detail: "x", pdpaConsent: true } });
  eq(c1.status, 401, "consult ไม่มี k = 401");
  const c2 = await call(formHandler, { body: { formType: "complaint", name: "ก", detail: "x", pdpaConsent: true } });
  eq(c2.status, 401, "complaint ไม่มี k = 401");
  const c3 = await call(formHandler, { body: { detail: "x", pdpaConsent: true } });
  eq(c3.status, 401, "ไม่ระบุ formType ไม่มี k = 401");
  const c4 = await call(formHandler, { url: "/api/form?action=add-evidence", body: { caseNo: "LG-2569-000001", evidencePaths: [] } });
  eq(c4.status, 401, "add-evidence ไม่มี k = 401");
  const c5 = await call(formHandler, { url: "/api/form?action=upload-url", body: { formType: "appointment", contentType: "image/png" } });
  eq(c5.status, 401, "upload-url ไม่มี k = 401 (โหมดเว็บไม่มีแนบไฟล์)");
  eq(fake.tables.cases.length, before, "ไม่มีเรื่องถูกสร้าง");
}

// 6.5 กันสแปม: honeypot / เวลาขั้นต่ำ / ไม่มีตรา / เพดานต่อ IP / เพดานรวม / ขนาด body
{
  resetCalls();
  const before = fake.tables.cases.length;
  const hp = await call(formHandler, { body: webBody({ honeypot: "http://spam.example" }) });
  ok(hp.status === 200 && hp.json.ok && !hp.json.caseNo, "honeypot = ตอบ ok เงียบๆ แต่ไม่บันทึก");
  const fast = await call(formHandler, { body: webBody({ stamp: makeWebFormStamp(Date.now() - 500) }) });
  ok(fast.status === 400 && fast.json.code === "too_fast", "ยื่นเร็วกว่า 4 วินาที = ปฏิเสธ");
  const none = await call(formHandler, { body: webBody({ stamp: undefined }) });
  ok(none.status === 400 && none.json.code === "stamp_bad", "ไม่มีตราเวลา = ปฏิเสธ");
  const noon = await call(formHandler, { body: webBody({ preferredTime: "12:00" }) });
  ok(noon.status === 400 && noon.json.field === "preferredTime", "เซิร์ฟเวอร์ตรวจเวลาซ้ำ (12:00 ไม่ผ่าน)");
  const sat = allowedApptDates(bkkTodayIso(), []).length && (() => {
    for (let i = 1; i < 10; i++) { const d = new Date(Date.now() + i * 86400e3); const iso = bkkTodayIso(d); const w = new Date(iso + "T00:00:00Z").getUTCDay(); if (w === 6) return iso; }
  })();
  const weekend = await call(formHandler, { body: webBody({ preferredDate: sat }) });
  ok(weekend.status === 400 && weekend.json.field === "preferredDate", "เซิร์ฟเวอร์ตรวจวันซ้ำ (เสาร์ไม่ผ่าน)");
  const huge = await call(formHandler, { body: JSON.stringify({ ...webBody(), detail: "ก".repeat(70000) }) });
  eq(huge.status, 413, "body ใหญ่เกิน 64KB = 413");
  eq(fake.tables.cases.length, before, "ไม่มีเรื่องไหนถูกบันทึกจากคำขอที่ถูกกันทั้งหมด");

  // เพดานต่อ IP: มีบันทึกในชั่วโมงนี้ครบ 3 แล้ว → ครั้งที่ 4 ถูกกัน
  const ip = "203.0.113.77";
  const hash = ipDayHash(ip, bkkTodayIso());
  for (let i = 0; i < WEB_LIMITS.perIpHour; i++) fake.tables.appointment_web_log.push({ id: nextId++, ip_hash: hash, created_at: new Date().toISOString() });
  const lim = await call(formHandler, { body: webBody(), ip });
  ok(lim.status === 429 && lim.json.code === "web_ip_limit", "เกินเพดานต่อ IP = 429: " + lim.body);
  ok(/โทร/.test(lim.json.error), "ข้อความเกินเพดานชวนโทรศูนย์");
  const other = await call(formHandler, { body: webBody() });
  ok(other.status === 200, "IP อื่นยังยื่นได้");

  // เพดานรวมรายวัน (ตั้ง env ทับให้เล็ก) — นับจากเรื่องเว็บวันนี้ที่มีอยู่แล้ว
  const webToday = fake.tables.cases.filter((c) => c.case_type === "appointment" && c.citizen_line_uid == null).length;
  process.env.APPT_WEB_DAILY_CAP = String(webToday);
  const cap = await call(formHandler, { body: webBody() });
  ok(cap.status === 429 && cap.json.code === "web_daily_cap", "ครบเพดานรวมรายวัน = 429: " + cap.body);
  delete process.env.APPT_WEB_DAILY_CAP;
  eq(pushesTo().filter((u) => u !== STAFF_UID).length, 0, "ทุกกรณีข้างบนไม่มีการยิงไลน์ถึงประชาชน");
}

// 6.6 สวิตช์ appointment_enabled ปิด = ทั้งเว็บและไลน์ไม่รับเรื่อง
{
  await setSetting("appointment_enabled", false);
  const before = fake.tables.cases.length;
  const cfg = await call(formHandler, { method: "GET", url: "/api/form?action=appt-config" });
  eq(cfg.json.enabled, false, "appt-config บอกหน้าเว็บว่าปิดรับ");
  const w = await call(formHandler, { body: webBody() });
  ok(w.status === 403 && w.json.code === "closed", "โหมดเว็บ: ปิดรับ = 403");
  const l = await call(formHandler, { body: { ...webBody(), stamp: undefined, k: makeFormToken(CITIZEN_UID, "appointment") } });
  ok(l.status === 403 && l.json.code === "closed", "โหมดไลน์: ปิดรับ = 403");
  ok(/ปิดรับ/.test(w.json.error), "ข้อความบอกว่าปิดรับชั่วคราว");
  eq(fake.tables.cases.length, before, "ไม่มีเรื่องถูกบันทึกตอนปิดรับ");
  await setSetting("appointment_enabled", true);
}

// 6.7 ยังไม่รัน migration-12 — บันทึกได้ (fallback) + เพดานต่อ IP ถอยไปนับในหน่วยความจำ
{
  fake.migrated = false;
  resetCalls();
  const ip = "203.0.113.200";
  const r = await call(formHandler, { body: webBody({ preferredTime: "09:00" }), ip });
  ok(r.status === 200 && r.json.ok, "ยังไม่รัน migration-12 ก็ยื่นได้: " + r.body);
  eq(fake.caseInserts.length, 2, "ลองพร้อมคอลัมน์ใหม่ก่อน แล้วบันทึกใหม่แบบไม่มี");
  const row = fake.tables.cases.find((c) => c.case_no === r.json.caseNo);
  ok(!NEW_CASE_COLS.some((c) => c in row), "แถวที่บันทึกไม่มีคอลัมน์ใหม่");
  ok(row.detail.includes("เวลาที่สะดวก 09:00 น.") && row.detail.includes("ยื่นผ่านเว็บไซต์"), "เวลา HH:MM + ช่องทางต่อท้ายรายละเอียด");
  eq(row.preferred_time_slot, "morning", "preferred_time_slot ยังบันทึก");
  eq(row.citizen_line_uid, null, "uid ยัง null");
  ok(pushesTo().every((u) => u === STAFF_UID), "fallback ก็ไม่ยิงไลน์ถึงประชาชน");
  // ยื่นซ้ำจาก IP เดิมจนครบเพดานต่อชั่วโมง → ตัวนับในหน่วยความจำต้องกันได้
  for (let i = 1; i < WEB_LIMITS.perIpHour; i++) {
    const again = await call(formHandler, { body: webBody(), ip });
    eq(again.status, 200, `ยื่นครั้งที่ ${i + 1} จาก IP เดิมยังได้`);
  }
  const blocked = await call(formHandler, { body: webBody(), ip });
  ok(blocked.status === 429 && blocked.json.code === "web_ip_limit", "ไม่มีตาราง log ก็ยังกันต่อ IP ได้ (หน่วยความจำ): " + blocked.body);
  // consult/complaint ไม่ถูกแตะ: ไม่ส่งคอลัมน์ใหม่เลย (ต้องบันทึกรอบเดียว)
  resetCalls();
  const kc = makeFormToken(CITIZEN_UID, "consult");
  const consult = await call(formHandler, { body: { k: kc, formType: "consult", name: "ทดสอบ", phone: "0812345678", detail: "ปรึกษา", pdpaConsent: true } });
  eq(consult.status, 200, "ฟอร์มปรึกษาเดิมยังใช้ได้ก่อนรัน migration-12");
  eq(fake.caseInserts.length, 1, "ฟอร์มปรึกษาบันทึกรอบเดียว ไม่มีคอลัมน์ใหม่ปน");
  ok(!NEW_CASE_COLS.some((c) => c in fake.caseInserts[0]), "ฟอร์มปรึกษาไม่ส่งคอลัมน์ใหม่");
  fake.migrated = true;
}

// 6.8 หลังบ้าน: เรื่องจากเว็บห้ามยิงไลน์ (แจ้งผล/ขอคะแนน) · เรื่องจากไลน์ยังทำงานเหมือนเดิม
{
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken(1))}`;
  const webCase = fake.tables.cases.find((c) => c.case_type === "appointment" && c.citizen_line_uid == null && c.status === "new");
  const lineCase = fake.tables.cases.find((c) => c.citizen_line_uid === CITIZEN_UID && c.status === "new");
  resetCalls();
  const n1 = await call(staffHandler, { url: "/api/staff?action=notify-citizen", cookie, body: { id: webCase.id, message: "นัดยืนยันแล้ว" } });
  ok(n1.status === 400 && n1.json.code === "no_line", "แจ้งผลเรื่องจากเว็บ = ปฏิเสธชัดเจน: " + n1.body);
  ok(!fake.tables.case_events.some((e) => e.case_id === webCase.id && e.action === "notified_citizen"), "ไม่บันทึกว่าแจ้งผลแล้วทั้งที่ไม่ได้ส่ง");
  const s1 = await call(staffHandler, { url: "/api/staff?action=status", cookie, body: { id: webCase.id, status: "closed" } });
  ok(s1.status === 200 && s1.json.ok, "ปิดเรื่องจากเว็บได้ตามปกติ");
  eq(pushesTo().length, 0, "ปิดเรื่องจากเว็บ = ไม่ยิงขอคะแนนทางไลน์ (ไม่มี push เลย)");

  resetCalls();
  const n2 = await call(staffHandler, { url: "/api/staff?action=notify-citizen", cookie, body: { id: lineCase.id, message: "นัดยืนยันแล้ว" } });
  ok(n2.status === 200 && n2.json.sent === true, "เรื่องจากไลน์ยังแจ้งผลได้");
  const s2 = await call(staffHandler, { url: "/api/staff?action=status", cookie, body: { id: lineCase.id, status: "closed" } });
  ok(s2.status === 200, "ปิดเรื่องจากไลน์ได้");
  eq(pushesTo().filter((u) => u === CITIZEN_UID).length, 2, "เรื่องจากไลน์: แจ้งผล + ขอคะแนน ถึง uid ผู้ยื่นเท่านั้น");
  ok(pushesTo().every((u) => u === CITIZEN_UID), "ไม่มี push ไปที่อื่น");

  // CSV มีคอลัมน์เวลาและช่องทาง
  const csv = await call(staffHandler, { method: "GET", url: "/api/staff?action=export", cookie });
  eq(csv.status, 200, "ส่งออก CSV ได้");
  const header = csv.body.replace(/^﻿/, "").split("\n")[0].split(",");
  ok(header.includes("preferred_time") && header.includes("source") && header.includes("citizen_district"), "CSV มีคอลัมน์เวลา/ช่องทาง/อำเภอ");
  ok(csv.body.includes(",web,") && csv.body.includes(",line,"), "CSV แยกช่องทาง web/line");
}
{
  const out = toCsv([{ case_no: "LG-1", citizen_line_uid: null, preferred_time: "10:00" }, { case_no: "LG-2", citizen_line_uid: CITIZEN_UID, source: "line" }]);
  const [head, r1, r2] = out.split("\n");
  const col = (line, name) => line.split(",")[head.split(",").indexOf(name)];
  eq(col(r1, "source"), "web", "ยังไม่มีคอลัมน์ source → เรื่องไม่มี uid = web");
  eq(col(r1, "preferred_time"), "10:00", "CSV มีเวลา HH:MM");
  eq(col(r2, "source"), "line", "เรื่องจากไลน์ = line");
  eq(csvEscape("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"", "กัน formula injection ใน CSV");
  eq(csvEscape("-5+3"), "'-5+3", "ค่าขึ้นต้นด้วย - ถูกทำให้เป็นข้อความ");
  eq(csvEscape("ปกติ"), "ปกติ", "ค่าปกติไม่เปลี่ยน");
}

// 6.9 อีเมลแจ้งเจ้าหน้าที่บอกเวลา/อำเภอ/ช่องทาง
{
  const txt = caseNotifyMailText({ case_no: "LG-2569-000009", case_type: "appointment", category: "debt", citizen_name: "นายก ข", citizen_phone: "0812345678", detail: "x", preferred_date: "2026-10-01", preferred_time: "13:00", preferred_time_slot: "afternoon", citizen_district: "สามชุก", citizen_line_uid: null });
  ok(txt.includes("13:00 น.") && txt.includes("สามชุก") && txt.includes("ยื่นผ่านเว็บไซต์"), "อีเมลมีเวลา/อำเภอ/ช่องทางเว็บ");
  const old = caseNotifyMailText({ case_no: "LG-2569-000010", case_type: "appointment", category: "debt", detail: "x", preferred_date: "2026-10-01", preferred_time_slot: "morning", citizen_line_uid: CITIZEN_UID });
  ok(old.includes("ช่วงเช้า") && !old.includes("ยื่นผ่านเว็บไซต์"), "เรื่องเก่า (ไม่มีเวลา) ยังโชว์ช่วงเช้า/บ่ายแบบเดิม");
}

// ═══════════════════ 7) หน้าเว็บ: ฟิลด์ครบตามมติ ไม่มีช่องเลขบัตร/อายุ/ที่อยู่ ═══════════════════
{
  const html = readFileSync(new URL("../public/appointment.html", import.meta.url), "utf8");
  for (const id of ["title", "titleOther", "firstName", "lastName", "phone", "district", "preferredDate", "times", "category", "detail", "pdpa", "lg_hp", "submitBtn", "cancelBtn"]) {
    ok(html.includes(`id="${id}"`), `หน้าแบบคำร้องมีช่อง ${id}`);
  }
  ok(!/บัตรประชาชน[^<]*<\/label>|id="(idCard|age|address)"/.test(html), "ไม่มีช่องเลขบัตร/อายุ/ที่อยู่");
  ok(html.includes("ยื่นแบบคำร้อง") && html.includes("ยกเลิก"), "ปุ่มยื่นแบบคำร้อง + ยกเลิก");
  ok(html.includes("ข้อมูลผู้ยื่นแบบคำร้อง") && html.includes("ข้าพเจ้า") && html.includes("มีความประสงค์ขอเข้ารับคำปรึกษาทางกฎหมาย"), "ประโยคแบบคำร้องตามต้นแบบ");
  ok(html.includes("logo-pao.png") && html.includes("logo-lawyers-council-sm.png"), "โลโก้คู่ อบจ. + สภาทนายความ");
  ok(html.includes("lg-submitted-") && html.includes("lg-appt-web-done"), "กันยื่นซ้ำด้วย sessionStorage ทั้งสองโหมด");
  ok(html.includes("@073kbdgu"), "หน้าสำเร็จมีปุ่มเพิ่มเพื่อน LINE OA");
  ok(!/liff/i.test(html), "ห้ามใช้ LIFF");
  const siteRender = readFileSync(new URL("../api/_site-render.js", import.meta.url), "utf8");
  ok(/href="\/appointment\.html"/.test(siteRender) && siteRender.includes("จองคิวขอเข้ารับคำปรึกษา"), "หน้าแรก SSR มีปุ่มจองคิวโหมดเว็บ");
}

console.log(`✅ test-appointment.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
