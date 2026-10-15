/* api/form.js — รับข้อมูลจากฟอร์มเว็บ (consult.html / complaint.html) เอนด์พอยต์เดียว แยก action
   ด้วย query string ?action=... เพื่อไม่เพิ่มจำนวน serverless function (เพดาน Vercel)

   action:
     config        GET  — คืนค่า public config ให้หน้าเว็บ (Supabase URL/anon key สำหรับอัปโหลดไฟล์เท่านั้น)
     verify        GET  — ตรวจลิงก์เฉพาะบุคคลว่ายังใช้ได้ไหม (หน้าเว็บเช็คตอนโหลดก่อนให้กรอก)
     upload-url    POST — ออก signed upload URL ให้ browser อัปโหลดไฟล์หลักฐานตรงไป Supabase Storage
     appt-config   GET  — ตัวเลือกของแบบคำร้องขอเข้ารับคำปรึกษา (วัน/เวลา/อำเภอ/หมวด) + ตราเวลากันบอท (30 ก.ย. 69)
     (default)     POST — บันทึกเรื่องจริง (ปรึกษา/ร้องเรียน/แบบคำร้องขอเข้ารับคำปรึกษา)

   ⛔ 30 ก.ย. 69: แบบคำร้องขอเข้ารับคำปรึกษา (formType "appointment") ยื่นจากเว็บตรงได้โดยไม่มีลิงก์ ?k=
   (บอสสั่ง "กดได้ทั้งบน web และ line oa") — citizen_line_uid = null + ด่านกันสแปม 4 ชั้น (honeypot /
   ตราเวลากรอกขั้นต่ำ / เพดานต่อ IP แบบแฮช HMAC / เพดานรวมต่อวัน) ฟอร์มอื่นยังบังคับ ?k= เหมือนเดิม
   ดู resolveFormAuth() ใน _formauth.js + api/_appointment.js + docs/BOOKING-FORM.md

   ปิด bodyParser อัตโนมัติเหมือน line-webhook.js — อ่าน raw body เองเสมอ กันพฤติกรรมไม่แน่นอนว่า
   Vercel จะ auto-parse JSON ให้ก่อนหรือไม่ (ถ้า auto-parse ไปแล้ว การอ่าน stream ซ้ำจะได้ค่าว่างเงียบๆ) */
export const config = { api: { bodyParser: false } };

import { readFormToken, resolveFormAuth, makeWebFormStamp, readWebFormStamp, ipDayHash } from "./_formauth.js";
import {
  createCase, getCaseByNo, addEvidenceFiles, citizenLineTarget, countWebAppointments, recordWebAppointment,
} from "./_cases.js";
import {
  APPT_TIMES, TITLES, DISTRICTS, CATEGORY_OPTIONS, FIELD_LIMITS, WEB_FORM_TIMING,
  allowedApptDates, bkkTodayIso, bkkDayStartUtcIso, validateAppointment, webLimits, webQuotaVerdict, apptClosedMessage,
} from "./_appointment.js";
import { APPOINTMENT_INFO, MAP_DIR_URL } from "./_serviceinfo.js";
import { createEvidenceUploadUrl, verifyUploadedFile, MAX_FILES } from "./_evidence.js";

/* ข้อมูลวันนัดจากแหล่งเดียว (api/_serviceinfo.js — ตัวเดียวกับที่การ์ดไลน์/ภาพวิธีจองคิวใช้) ค่า null = ไม่ส่ง */
function visitInfo() {
  const a = APPOINTMENT_INFO;
  const loc = a.location;
  return {
    room: loc?.room || null,
    place: loc?.place || null,
    address: loc?.address || null,
    mapDirUrl: MAP_DIR_URL || null,
    lawyerSchedule: a.lawyer_schedule || null,
    lawyerOff: a.lawyer_off || null,
    documents: Array.isArray(a.documents) ? a.documents : [],
    documentsNote: a.documents_note || null,
  };
}
import { push, pushAllowed } from "./_lineapi.js";
import { caseConfirmCard } from "./_cards.js";
import { getSettings, isOfficeHoursNow } from "./_settings.js";
// 2 ต.ค. 69: notifyStaff/notifyEvidenceAdded ย้ายไป api/_notify.js (ใช้ร่วมกับรับเรื่องทางแชตใน line-webhook.js)
import { notifyStaff, notifyEvidenceAdded } from "./_notify.js";

/* กันฟอร์มถูกยิงรัว — best-effort ต่ออินสแตนซ์ (ไม่เป๊ะ 100% แต่พอกันสแปมอัตโนมัติ) */
const hits = new Map();
function rateLimited(key, max = 8, windowMs = 5 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

/* เพดานขนาด body 64KB (เพิ่ม 30 ก.ย. 69 พร้อมโหมดเว็บที่ไม่ต้องมีลิงก์จากไลน์) — ฟอร์มทุกใบส่งแค่ข้อความ+
   path ไฟล์ (ไฟล์จริงอัปโหลดตรงไป Supabase) ไม่มีทางเกินนี้ถ้าไม่ใช่การยิงขยะ */
const MAX_BODY_BYTES = 64 * 1024;
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const e = new Error("body too large");
      e.status = 413;
      throw e;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  const action = req.query?.action || new URL(req.url, "http://x").searchParams.get("action") || "submit";

  try {
    if (action === "config" && req.method === "GET") {
      const settings = await getSettings();
      return json(res, 200, {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        officeHours: settings.office_hours,
        holidays: settings.holidays,
      });
    }

    if (action === "verify" && req.method === "GET") {
      const k = req.query?.k || new URL(req.url, "http://x").searchParams.get("k");
      const formType = req.query?.type || new URL(req.url, "http://x").searchParams.get("type");
      const read = readFormToken(k, formType);
      return json(res, 200, read);
    }

    // ── ตัวเลือกของแบบคำร้องขอเข้ารับคำปรึกษา (appointment.html ดึงจากที่นี่ที่เดียว ไม่เขียนรายการซ้ำใน HTML)
    // stamp = ตราเวลาเปิดฟอร์มเซ็น HMAC ใช้ตรวจเวลากรอกขั้นต่ำตอนยื่นโหมดเว็บ (บอทยิงทันที = ไม่ผ่าน)
    if (action === "appt-config" && req.method === "GET") {
      const s = await getSettings();
      res.setHeader("Cache-Control", "no-store");
      return json(res, 200, {
        ok: true,
        enabled: !!s.appointment_enabled,
        phone: s.phone,
        officeHours: s.office_hours,
        responderLabel: s.responder_label,
        dates: allowedApptDates(bkkTodayIso(), s.holidays),
        times: APPT_TIMES,
        titles: TITLES,
        districts: DISTRICTS,
        categories: CATEGORY_OPTIONS,
        limits: FIELD_LIMITS,
        minFillSeconds: Math.ceil(WEB_FORM_TIMING.minFillMs / 1000),
        stamp: makeWebFormStamp(),
        visit: visitInfo(), // 30 ก.ย. 69: สถานที่/เวลาทนายอาสา/เอกสาร (ข้อมูลจริงจากบอส) โชว์บนหน้า "ยื่นสำเร็จ"
      });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method not allowed" });

    if (rateLimited(clientIp(req))) {
      return json(res, 429, { ok: false, error: "ส่งข้อมูลถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" });
    }

    const body = await readJsonBody(req);

    if (action === "upload-url") {
      const read = readFormToken(body.k, body.formType);
      if (!read.ok) return json(res, 401, read);
      const result = await createEvidenceUploadUrl(read.uid, body.contentType);
      return json(res, result.ok ? 200 : 400, result);
    }

    // ── action=add-evidence — แนบไฟล์เพิ่มเข้าเรื่องเดิมหลังยื่นไปแล้ว (แนวคิดจาก Traffy Fondue เพิ่ม
    // 17 ก.ย. 69 — ไม่ต้องยื่นเรื่องใหม่) ใช้ formToken ประเภท "addevidence" เดียวกับที่ออกจาก postback
    // lg:addevidence:<caseNo> ใน line-webhook.js — ตรวจสิทธิ์ด้วย citizen_line_uid ตรงกับ uid ในโทเคน
    // เสมอ (ไม่ใช่พึ่ง caseNo ที่ client ส่งมาเป็นตัวยืนยันสิทธิ์ กัน tamper เลขเรื่องในลิงก์) ═══
    if (action === "add-evidence") {
      const read = readFormToken(body.k, "addevidence");
      if (!read.ok) return json(res, 401, read);
      const caseNo = String(body.caseNo || "").trim().toUpperCase();
      const row = await getCaseByNo(caseNo).catch(() => null);
      if (!row || row.citizen_line_uid !== read.uid) return json(res, 404, { ok: false, error: "ไม่พบเรื่องนี้ หรือไม่มีสิทธิ์แนบไฟล์" });
      if (row.status === "closed" || row.status === "withdrawn") {
        return json(res, 400, { ok: false, error: "เรื่องนี้ปิด/ยกเลิกแล้ว ไม่สามารถแนบหลักฐานเพิ่มได้ กรุณาติดต่อเจ้าหน้าที่โดยตรงหากจำเป็น" });
      }
      const paths = Array.isArray(body.evidencePaths) ? body.evidencePaths.slice(0, MAX_FILES) : [];
      const verified = [];
      for (const p of paths) {
        if (typeof p === "string" && p.startsWith(read.uid + "/") && (await verifyUploadedFile(p))) verified.push(p);
      }
      if (!verified.length) return json(res, 400, { ok: false, error: "ไม่มีไฟล์ที่อัปโหลดสำเร็จ กรุณาลองใหม่อีกครั้ง" });
      const updated = await addEvidenceFiles(row.id, verified);
      await notifyEvidenceAdded(updated).catch((e) => console.error("notifyEvidenceAdded failed", e));
      return json(res, 200, { ok: true, totalFiles: (updated.evidence_paths || []).length });
    }

    // ── action=submit (ค่าเริ่มต้น) ──
    if (body.honeypot) return json(res, 200, { ok: true }); // บอทกรอกช่องที่ซ่อนไว้ — เงียบไว้ ไม่ใช่บั๊ก
    // มี ?k= = ตรวจลิงก์จากไลน์เหมือนเดิม · ไม่มี ?k= ผ่านได้เฉพาะ formType "appointment" (โหมดเว็บ 30 ก.ย. 69)
    const read = resolveFormAuth(body);
    if (!read.ok) return json(res, 401, read);

    // แบบคำร้องขอเข้ารับคำปรึกษาแยกไปอีกเส้นทางทั้งหมด (ฟิลด์/การตรวจ/กันสแปมต่างจากฟอร์มปรึกษา/ร้องเรียน)
    if (read.formType === "appointment") return await submitAppointment(req, res, body, read);

    const detail = String(body.detail || "").trim();
    if (!detail) return json(res, 400, { ok: false, error: "กรุณากรอกรายละเอียด" });
    if (!body.pdpaConsent) return json(res, 400, { ok: false, error: "กรุณายอมรับข้อตกลงการใช้ข้อมูลส่วนบุคคล" });

    // เบอร์โทรบังคับเฉพาะฟอร์มปรึกษา (ต้องโทรกลับได้แน่ๆ — แบบคำร้องขอเข้ารับคำปรึกษาตรวจใน
    // submitAppointment() ตั้งแต่ 30 ก.ย. 69) — ฟอร์มร้องเรียนไม่บังคับเพราะรองรับ
    // "ไม่ประสงค์ออกนาม" ได้ เดิม validate ฝั่งเว็บ (HTML required) เท่านั้น ไม่มีชั้นกันฝั่งเซิร์ฟเวอร์
    // (พบจากรีวิวความปลอดภัย 18 ก.ย. 69 — ไม่มีคนแจ้ง) เพิ่มชั้นนี้กันเรื่องเบอร์ว่างหลุดเข้าระบบถ้ามีใคร
    // ยิง API ตรงข้าม HTML form
    const phone = String(body.phone || "").trim();
    if (read.formType === "consult" && !phone) {
      return json(res, 400, { ok: false, error: "กรุณากรอกเบอร์โทรศัพท์" });
    }

    const evidencePaths = Array.isArray(body.evidencePaths) ? body.evidencePaths.slice(0, MAX_FILES) : [];
    const verified = [];
    for (const p of evidencePaths) {
      if (typeof p === "string" && p.startsWith(read.uid + "/") && (await verifyUploadedFile(p))) verified.push(p);
    }
    if (evidencePaths.length && !verified.length) {
      return json(res, 400, { ok: false, error: "ไฟล์หลักฐานอัปโหลดไม่สำเร็จ กรุณาลองแนบไฟล์อีกครั้ง" });
    }

    // An accepted path can already belong to a previous case (including a retry after success).
    // Never delete evidence on an uncertain/failed insert; orphan cleanup must verify references first.
    const caseRow = await createCase({
      caseType: read.formType,
      category: body.category || "other",
      citizenName: body.isAnonymous ? null : String(body.name || "").trim(),
      citizenPhone: phone,
      citizenLineUid: read.uid,
      isAnonymous: !!body.isAnonymous,
      detail,
      respondent: body.respondent ? String(body.respondent).trim() : null,
      demand: body.demand ? String(body.demand).trim() : null,
      evidencePaths: verified,
      pdpaConsent: true,
    });

    const settings = await getSettings();
    const officeHours = isOfficeHoursNow(settings);

    /* ⚠️ ต้อง await ทั้งคู่ก่อนตอบ HTTP response เสมอ — ห้ามยิงแบบ fire-and-forget (.catch() เฉยๆ
       โดยไม่ await) เพราะ Vercel serverless อาจตัดการทำงานทันทีหลัง response ถูกส่ง ทำให้การแจ้งเตือน
       ที่ยังไม่เสร็จหายไปเงียบๆ (ผู้ใช้เห็น "ส่งสำเร็จ" แต่เจ้าหน้าที่ไม่ได้รับแจ้งจริง — ร้ายแรงกว่า
       ตอบช้าลงเล็กน้อย) errors ภายในแต่ละฟังก์ชันจับไว้แล้วไม่ทำให้ทั้ง request ล้ม */
    await notifyStaff(caseRow).catch((e) => console.error("notifyStaff failed", e));
    const citizenUid = citizenLineTarget(caseRow); // กัน null — เรื่องที่ไม่มีไลน์ห้ามพยายามยิง (30 ก.ย. 69)
    if (citizenUid && (await pushAllowed("urgent"))) {
      await push(citizenUid, caseConfirmCard(caseRow, settings.responder_label)).catch((e) => console.error("confirm push failed", e));
    }

    return json(res, 200, { ok: true, caseNo: caseRow.case_no, officeHours });
  } catch (e) {
    if (e?.status === 413) return json(res, 413, { ok: false, error: "ข้อมูลที่ส่งมีขนาดใหญ่เกินไป กรุณาลดความยาวข้อความแล้วลองใหม่" });
    console.error("form.js error", e);
    return json(res, 500, { ok: false, error: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หรือโทรติดต่อเจ้าหน้าที่โดยตรง" });
  }
}

/* ═══ แบบคำร้องขอเข้ารับคำปรึกษาทางกฎหมาย (30 ก.ย. 69) — ใช้ได้ 2 ทาง ═══
   (1) จากไลน์: read.uid มาจากลิงก์ ?k= (postback lg:appointment:open) → ผูก citizen_line_uid + ส่งการ์ดยืนยันเข้าแชต
   (2) จากเว็บ: read.web = true → citizen_line_uid = null ห้ามยิงไลน์ถึงประชาชน + ผ่านด่านกันสแปมก่อนบันทึก
   ทั้งสองทางเคารพสวิตช์ appointment_enabled (ปิด = ไม่รับเรื่อง) และแจ้งเจ้าหน้าที่แบบเดียวกับเรื่องอื่น */
async function submitAppointment(req, res, body, read) {
  const isWeb = !!read.web;
  const settings = await getSettings();
  if (!settings.appointment_enabled) {
    return json(res, 403, { ok: false, code: "closed", error: apptClosedMessage(settings.phone) });
  }

  if (isWeb) {
    const st = readWebFormStamp(body.stamp, WEB_FORM_TIMING);
    if (!st.ok) return json(res, 400, { ok: false, code: st.code, error: st.reason });
  }

  // เซิร์ฟเวอร์ตรวจซ้ำทุกช่อง (วัน = 14 วันทำการ · เวลา = ชุด 09–15 น. เว้นเที่ยง · ความยาว) ไม่เชื่อหน้าเว็บ
  const todayIso = bkkTodayIso();
  const v = validateAppointment(body, { todayIso, holidays: settings.holidays });
  if (!v.ok) return json(res, 400, { ok: false, field: v.field, error: v.error });

  let ipHash = null;
  if (isWeb) {
    ipHash = ipDayHash(clientIp(req), todayIso); // ไม่เก็บ IP ดิบ — แฮช HMAC รายวันเท่านั้น
    const counts = await countWebAppointments(ipHash, bkkDayStartUtcIso(todayIso));
    const verdict = webQuotaVerdict(counts, webLimits(), settings.phone);
    if (!verdict.ok) return json(res, 429, { ok: false, code: verdict.code, error: verdict.error });
  }

  const a = v.value;
  const caseRow = await createCase({
    caseType: "appointment",
    category: a.category,
    citizenName: a.citizenName,
    citizenPhone: a.phone,
    citizenLineUid: isWeb ? null : read.uid,
    isAnonymous: false,
    detail: a.detail,
    evidencePaths: [],
    pdpaConsent: true,
    preferredDate: a.preferredDate,
    preferredTimeSlot: a.preferredTimeSlot,
    preferredTime: a.preferredTime,
    citizenDistrict: a.district,
    source: isWeb ? "web" : "line",
  });
  if (isWeb) await recordWebAppointment(ipHash).catch((e) => console.error("recordWebAppointment failed", e));

  // ⚠️ await ครบก่อนตอบเหมือนเส้นทางหลัก (Vercel อาจตัดงานที่ค้างหลังส่ง response)
  await notifyStaff(caseRow).catch((e) => console.error("notifyStaff failed", e));
  let confirmSent = false;
  const citizenUid = citizenLineTarget(caseRow); // โหมดเว็บได้ null เสมอ → ไม่ยิงไลน์
  if (citizenUid && (await pushAllowed("urgent"))) {
    confirmSent = await push(citizenUid, caseConfirmCard(caseRow, settings.responder_label)).catch((e) => { console.error("confirm push failed", e); return false; });
  }

  return json(res, 200, {
    ok: true,
    caseNo: caseRow.case_no,
    channel: isWeb ? "web" : "line",
    confirmSent,
    officeHours: isOfficeHoursNow(settings),
    phone: settings.phone,
  });
}
