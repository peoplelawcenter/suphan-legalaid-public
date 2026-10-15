/* api/_cases.js — สูตรเดียวสำหรับสร้าง/อ่าน/แก้ "เรื่อง" (ปรึกษา/ร้องเรียน) ใช้ร่วมกันทุกจุด
   (webhook ตอบสถานะ, form.js ตอนบันทึกใหม่, staff.js ตอนจัดการ) ห้ามมีจุดอื่นเขียน SQL เอง */
import { db } from "./_db.js";

export const STATUSES = ["new", "assigned", "in_progress", "need_info", "closed", "withdrawn"];

/* เส้นทางเปลี่ยนสถานะที่อนุญาต — ปิดเรื่องแล้วห้ามเปลี่ยนอีก (ต้องให้แอดมินเปิดเรื่องใหม่แทน)
   withdrawn (ยกเลิกโดยผู้แจ้งเอง — แนวคิดจาก Traffy Fondue ปุ่ม "ยกเลิกเรื่อง") ทำได้จาก new เท่านั้น
   (บอสยืนยัน 17 ก.ย. 69: "เฉพาะตอนยังไม่มีคนรับเรื่อง") ตัวเรียกใน line-webhook.js ส่ง actorUid="citizen"
   เสมอสำหรับเส้นทางนี้ ไม่ใช่เจ้าหน้าที่กดจากหลังบ้าน (staff.js ไม่มี action ไหนอนุญาตให้ตั้ง withdrawn) */
const ALLOWED_TRANSITIONS = {
  new: ["assigned", "closed", "withdrawn"],
  assigned: ["in_progress", "need_info", "closed"],
  in_progress: ["need_info", "closed"],
  need_info: ["in_progress", "closed"],
  closed: [],
  withdrawn: [],
};

export function canTransition(from, to) {
  return Array.isArray(ALLOWED_TRANSITIONS[from]) && ALLOWED_TRANSITIONS[from].includes(to);
}

export async function logEvent(caseId, actor, action, note = null) {
  const { error } = await db().from("case_events").insert({ case_id: caseId, actor, action, note });
  if (error) console.error("logEvent failed", error); // การบันทึกพลาดต้องไม่ทำให้ผู้ใช้เห็นว่างานล้ม
}

/* เลขเรื่องออกจาก Postgres sequence ผ่าน RPC next_case_no() (ดู supabase-setup.sql) — atomic
   กันชนกันตอนมีคนยื่นพร้อมกันจริง ไม่ใช่ count(*)+1 ที่ race กันได้ */
export async function createCase({
  caseType, category, citizenName, citizenPhone, citizenLineUid, isAnonymous,
  detail, respondent, demand, evidencePaths, pdpaConsent, preferredDate, preferredTimeSlot,
  preferredTime, citizenDistrict, source, submissionId,
}) {
  const { data: caseNo, error: seqErr } = await db().rpc("next_case_no");
  if (seqErr) throw new Error("ออกเลขที่เรื่องไม่สำเร็จ: " + seqErr.message);

  // คอลัมน์ใหม่ของ migration-12 (30 ก.ย. 69) ใส่เฉพาะแบบคำร้องขอเข้ารับคำปรึกษา — ถ้ายังไม่รัน migration-12
  // insertCaseWithFallback() บันทึกใหม่แบบไม่มีคอลัมน์พวกนี้ แล้วเขียนข้อมูลต่อท้ายรายละเอียดแทน (เรื่องไม่หาย)
  // 2 ต.ค. 69 (รับเรื่องทางแชต): ประเภทอื่นส่ง source ได้ด้วยถ้าผู้เรียกระบุ (เรื่องจากแชต = 'chat') — ไม่ระบุ = ไม่ใส่คีย์
  // ให้ DB ใช้ default 'line' เหมือนเดิม (ฟอร์มปรึกษา/ร้องเรียนเดิมไม่เปลี่ยนพฤติกรรม)
  const extras = caseType === "appointment"
    ? { preferred_time: preferredTime || null, citizen_district: citizenDistrict || null, source: source || (citizenLineUid ? "line" : "web") }
    : (source ? { source } : {});
  const insertFn = (row) => db().from("cases").insert(row).select().single();
  const chatNote = extras.source === "chat" ? CHAT_SOURCE_NOTE : "";
  const baseRow = {
      case_no: caseNo,
      case_type: caseType,
      category: category || "other",
      citizen_name: citizenName || null,
      citizen_phone: citizenPhone || null,
      citizen_line_uid: citizenLineUid || null,
      is_anonymous: !!isAnonymous,
      detail,
      respondent: respondent || null,
      demand: demand || null,
      evidence_paths: evidencePaths || [],
      pdpa_consent: !!pdpaConsent,
      pdpa_consent_at: pdpaConsent ? new Date().toISOString() : null,
      // รหัสนี้เป็นเงื่อนไขความถูกต้องของการรับเรื่องทางแชต จึงไม่ใส่ในกลุ่มคอลัมน์ที่ยอม fallback
      // ถ้ายังไม่รัน migration-15 ต้องคืนร่างให้ผู้ใช้ ไม่สร้างเรื่องที่ตามผลแบบแน่นอนไม่ได้
      ...(submissionId ? { submission_id: submissionId } : {}),
      // ⚠️ ใส่ 2 คีย์นี้เฉพาะตอน caseType==='appointment' เท่านั้น (ไม่ใช่ตั้งเป็น null เฉยๆ) — ถ้าใส่คีย์
      // นี้เข้าไปเสมอ แล้วยังไม่ได้รัน supabase-migration-2-appointment.sql บน DB จริง Postgrest จะโยน error
      // "column not found" ทำให้ฟอร์มปรึกษา/ร้องเรียนเดิมพังไปด้วยทั้งที่ไม่เกี่ยวกัน
      ...(caseType === "appointment" ? { preferred_date: preferredDate || null, preferred_time_slot: preferredTimeSlot || null } : {}),
  };
  let { data, error } = await insertCaseWithFallback(insertFn, baseRow, extras,
    apptFallbackNote({ preferredTime, citizenDistrict, source: extras.source }) + chatNote);
  // 2 ต.ค. 69: ยังไม่รัน migration-14 (check ของ source ยังไม่รู้จัก 'chat' → 23514) → บันทึกเป็น 'line' + ป้ายช่องทางในรายละเอียด
  // ⚠️ ถอยเฉพาะ source 'chat' ที่ชน check เท่านั้น — check อื่นพังต้องโยนต่อ ห้ามกลืน (เรื่องต้องไม่เข้าระบบแบบข้อมูลผิด)
  if (error && chatNote && isCheckViolation(error)) {
    console.error("cases: ยังไม่ได้รัน migration-14 — บันทึกเรื่องจากแชตเป็น source 'line' + ป้ายในรายละเอียดแทน");
    ({ data, error } = await insertCaseWithFallback(insertFn, { ...baseRow, detail: String(baseRow.detail || "") + chatNote },
      { ...extras, source: "line" }, apptFallbackNote({ preferredTime, citizenDistrict, source: "line" })));
  }
  // webhook อาจ retry หลัง DB บันทึกสำเร็จแต่ process ตายก่อนตอบ — unique submission_id ทำให้คืนเรื่องเดิมแทนสร้างซ้ำ
  if (error && submissionId && (error.code === "23505" || /duplicate key|unique constraint/i.test(String(error.message || "")))) {
    const existing = await db().from("cases").select().eq("submission_id", submissionId).maybeSingle();
    if (!existing.error && existing.data) return existing.data;
  }
  if (error) throw new Error("บันทึกเรื่องไม่สำเร็จ: " + error.message);

  await logEvent(data.id, "system", "created", null);
  return data;
}

/* ═══ เรื่องที่รับทางแชตไลน์ (2 ต.ค. 69 — ประชาชนพิมพ์เล่าในแชตแล้วกดส่ง ไม่ได้กรอกแบบฟอร์ม) ═══
   ปกติ source = 'chat' · ถ้ายังไม่รัน migration-14 จะเป็น 'line' + ป้ายนี้ต่อท้ายรายละเอียด (หลังบ้าน/อีเมลดูจากทั้งสองทาง) */
export const CHAT_SOURCE_TAG = "[ช่องทาง: แจ้งทางแชตไลน์]";
const CHAT_SOURCE_NOTE = "\n\n" + CHAT_SOURCE_TAG;
export function isChatCase(row) {
  if (!row || typeof row !== "object") return false;
  return row.source === "chat" || String(row.detail || "").includes(CHAT_SOURCE_TAG);
}
export function isCheckViolation(error) {
  if (!error) return false;
  return error.code === "23514" || /violates check constraint/i.test(String(error.message || ""));
}

/* ═══ บันทึกได้แม้ยังไม่รัน supabase-migration-12-appointment-web.sql (เพิ่ม 30 ก.ย. 69) ═══
   ลองบันทึกพร้อมคอลัมน์ใหม่ก่อน → ถ้า Postgrest ตอบว่าไม่รู้จักคอลัมน์ (PGRST204 / 42703) บันทึกใหม่แบบไม่มี
   คอลัมน์ใหม่ + ต่อท้ายรายละเอียดด้วยข้อมูลเดียวกัน (เวลาที่สะดวก HH:MM/อำเภอ/ช่องทาง) ให้เจ้าหน้าที่ยังเห็นครบ
   ⚠️ เช็คเฉพาะ error "ไม่มีคอลัมน์" เท่านั้น — error อื่น (เช่น not-null/check constraint) ต้องโยนต่อ ห้ามกลืน
   insertFn แยกออกมาเป็นพารามิเตอร์เพื่อให้ scripts/test-appointment.mjs ทดสอบได้โดยไม่ต้องมี DB จริง */
export function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /could not find the .+ column|column .+ does not exist/i.test(String(error.message || ""));
}
/* ชื่อคอลัมน์ที่ Postgrest/Postgres บอกว่าไม่มี (PGRST204: "Could not find the 'x' column ..." · 42703: 'column "x" ... does not exist') */
export function missingColumnName(error) {
  const msg = String(error?.message || "");
  const m = /could not find the '([^']+)' column/i.exec(msg) || /column "([^"]+)"[^]*?does not exist/i.exec(msg);
  return m ? m[1] : null;
}
const COLUMN_MIGRATION = { preferred_time: "migration-12", citizen_district: "migration-12", source: "migration-12", submission_id: "migration-15" };
export function missingColumnLogText(error, extras = {}) {
  const col = missingColumnName(error);
  if (!col) return `ไม่มีคอลัมน์บางตัวในตาราง cases (อ่านชื่อจาก error ไม่ได้ · คอลัมน์ที่ส่ง: ${Object.keys(extras).join(", ") || "-"})`;
  const mig = COLUMN_MIGRATION[col];
  return `ตาราง cases ไม่มีคอลัมน์ "${col}"${mig ? ` (ยังไม่ได้รัน ${mig})` : ""}`;
}
export function isMissingTableError(error) {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return /could not find the table|relation .+ does not exist/i.test(String(error.message || ""));
}

export function apptFallbackNote({ preferredTime, citizenDistrict, source } = {}) {
  const lines = [];
  if (preferredTime) lines.push(`เวลาที่สะดวก ${preferredTime} น.`);
  if (citizenDistrict) lines.push(`อำเภอที่อยู่: ${citizenDistrict}`);
  if (source === "web") lines.push("ช่องทาง: ยื่นผ่านเว็บไซต์ (ไม่มีไลน์)");
  return lines.length ? `\n\n[ข้อมูลนัดหมาย] ${lines.join(" · ")}` : "";
}

export async function insertCaseWithFallback(insertFn, row, extras = {}, fallbackNote = "") {
  if (!extras || !Object.keys(extras).length) return { ...(await insertFn(row)), usedFallback: false };
  const first = await insertFn({ ...row, ...extras });
  if (!first.error || !isMissingColumnError(first.error)) return { ...first, usedFallback: false };
  // 5 ต.ค. 69 (nit จาก code-reviewer): เดิม log "ยังไม่ได้รัน migration-12" ทุกครั้ง แม้คอลัมน์ที่หายจริงคือ submission_id (migration-15)
  // → บอกชื่อคอลัมน์จริงจาก error + migration ที่เพิ่มคอลัมน์นั้น (พฤติกรรมบันทึกเหมือนเดิมทุกอย่าง แก้แค่ข้อความ log)
  console.error(`cases: ${missingColumnLogText(first.error, extras)} — บันทึกแบบไม่มีคอลัมน์ใหม่แทน`, first.error.message);
  const second = await insertFn({ ...row, detail: String(row.detail || "") + fallbackNote });
  return { ...second, usedFallback: true };
}

/* ═══ ด่านกัน null ก่อนยิงไลน์ถึงประชาชน (เพิ่ม 30 ก.ย. 69) — เรื่องที่ยื่นผ่านเว็บไม่มี citizen_line_uid
   ทุกจุดที่ push/ขอคะแนน/แจ้งผลถึงประชาชนต้องผ่านฟังก์ชันนี้ คืน uid ที่ใช้ได้จริง หรือ null = ห้ามยิง
   (LINE userId รูปแบบ "U" + hex 32 ตัวเสมอ ค่าอื่นยิงไปก็ได้ 400 กลับมาเปล่าๆ) */
export function citizenLineTarget(row) {
  const uid = row && typeof row === "object" ? row.citizen_line_uid : null;
  return typeof uid === "string" && /^U[0-9a-f]{32}$/i.test(uid) ? uid : null;
}

/* ═══ นับเพดานกันสแปมของแบบคำร้องที่ยื่นผ่านเว็บ (เพิ่ม 30 ก.ย. 69) ═══
   - ต่อ IP: ตาราง appointment_web_log (ip_hash = HMAC รายวัน ไม่มี IP ดิบ) — ถ้ายังไม่รัน migration-12
     ถอยไปนับในหน่วยความจำต่ออินสแตนซ์แทน (ไม่เป๊ะข้ามอินสแตนซ์ แต่ยังกันยิงรัวได้)
   - รวมทั้งวัน: นับจาก cases ที่ case_type='appointment' และ citizen_line_uid is null (ใช้ได้ตั้งแต่ก่อนรัน
     migration-12 เพราะไม่พึ่งคอลัมน์ source) */
const memWebLog = new Map(); // ip_hash → [timestamps]
function memCounts(ipHash, now) {
  const arr = (memWebLog.get(ipHash) || []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  memWebLog.set(ipHash, arr);
  return { ipHour: arr.filter((t) => now - t < 60 * 60 * 1000).length, ipDay: arr.length };
}

// ⚠️ ใช้ GET + limit(1) ไม่ใช่ head:true — postgrest-js แปลง HEAD ที่ได้ 404 (ตารางยังไม่มี) เป็น "ไม่มี error"
// เงียบๆ (HEAD ไม่มี body ให้อ่านรหัส error) ทำให้แยกไม่ออกว่ายังไม่รัน migration-12
export async function countWebAppointments(ipHash, dayStartUtcIso, now = Date.now()) {
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const [globalRes, dayRes, hourRes] = await Promise.all([
    db().from("cases").select("id", { count: "exact" })
      .eq("case_type", "appointment").is("citizen_line_uid", null).gte("created_at", dayStartUtcIso).limit(1),
    db().from("appointment_web_log").select("id", { count: "exact" }).eq("ip_hash", ipHash).gte("created_at", dayStartUtcIso).limit(1),
    db().from("appointment_web_log").select("id", { count: "exact" }).eq("ip_hash", ipHash).gte("created_at", hourAgo).limit(1),
  ]);
  if (globalRes.error) throw new Error("นับเรื่องจากเว็บไม่สำเร็จ: " + globalRes.error.message);
  const globalDay = globalRes.count || 0;
  if (dayRes.error || hourRes.error) {
    const err = dayRes.error || hourRes.error;
    if (!isMissingTableError(err)) throw new Error("นับเพดานต่อเครือข่ายไม่สำเร็จ: " + err.message);
    return { globalDay, ...memCounts(ipHash, now), ipTracked: false };
  }
  // รวมกับตัวนับในหน่วยความจำด้วย (เอาค่ามากกว่า) — กันช่วงสั้นๆ ที่บันทึกลงตารางไม่สำเร็จ
  const mem = memCounts(ipHash, now);
  return { globalDay, ipHour: Math.max(hourRes.count || 0, mem.ipHour), ipDay: Math.max(dayRes.count || 0, mem.ipDay), ipTracked: true };
}

export async function recordWebAppointment(ipHash, now = Date.now()) {
  memWebLog.set(ipHash, [...(memWebLog.get(ipHash) || []), now]);
  const { error } = await db().from("appointment_web_log").insert({ ip_hash: ipHash });
  if (error) {
    if (!isMissingTableError(error)) console.error("recordWebAppointment failed", error);
    return false;
  }
  // ล้างแถวเก่าเกิน 2 วันทิ้งไปพร้อมกัน (แฮชเปลี่ยนทุกวันอยู่แล้ว เก็บไว้นานไม่มีประโยชน์)
  const { error: purgeErr } = await db().from("appointment_web_log").delete().lt("created_at", new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString());
  if (purgeErr) console.error("purge appointment_web_log failed", purgeErr);
  return true;
}

export async function getCaseByNo(caseNo) {
  const { data, error } = await db().from("cases").select("*").eq("case_no", caseNo).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCaseById(id) {
  const { data, error } = await db().from("cases").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listEvents(caseId) {
  const { data, error } = await db().from("case_events").select("*").eq("case_id", caseId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listCases({ status, q, limit = 50, offset = 0 } = {}) {
  let query = db().from("cases").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (q) {
    // ตัดอักขระที่มีความหมายพิเศษใน syntax ของ .or() ออกก่อนต่อสตริง (comma แบ่งเงื่อนไข, วงเล็บจัดกลุ่ม)
    // ไม่งั้นค้นหาคำที่มีเครื่องหมายพวกนี้จะทำให้ query พังหรือความหมายเปลี่ยนไปจากที่ผู้ใช้ตั้งใจ
    const safe = String(q).replace(/[,()]/g, " ").trim();
    const like = `%${safe}%`;
    query = query.or(`case_no.ilike.${like},citizen_name.ilike.${like},citizen_phone.ilike.${like}`);
  }
  query = query.range(offset, offset + limit - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data || [], total: count || 0 };
}

/* actorUid: uid ของเจ้าหน้าที่ที่กดเปลี่ยน — ใส่ไว้ใน case_events เสมอเพื่อตรวจสอบย้อนหลังได้ */
export async function updateStatus(caseId, newStatus, actorUid, note) {
  if (!STATUSES.includes(newStatus)) throw new Error("สถานะไม่ถูกต้อง: " + newStatus);
  const current = await getCaseById(caseId);
  if (!current) throw new Error("ไม่พบเรื่องนี้");
  if (current.status === newStatus) return current; // idempotent กันกดซ้ำ
  if (!canTransition(current.status, newStatus)) {
    throw new Error(`เปลี่ยนสถานะจาก "${current.status}" เป็น "${newStatus}" ไม่ได้`);
  }
  const patch = { status: newStatus, updated_at: new Date().toISOString() };
  // เจ้าหน้าที่กดเปลี่ยนสถานะเป็น "มอบหมายแล้ว" เองโดยไม่ผ่าน dropdown มอบหมาย (แท็บ "ผู้รับผิดชอบ") →
  // ถือว่าตัวเองรับเป็นผู้รับผิดชอบไปเลย (ฟีเจอร์เดิมตั้งแต่ก่อนรอบ 3 แค่เปลี่ยนคอลัมน์จาก
  // assigned_staff_uid เป็น assigned_staff_id เพราะเจ้าหน้าที่ไม่ผูกกับ LINE uid บังคับอีกต่อไป)
  // actorUid มาจาก staff.js เสมอเป็นเลข staff.id แบบ string เท่านั้น ("citizen"/"system" ไม่มีทางมาถึง
  // เส้นทางนี้เพราะประชาชนไม่มีสิทธิ์ตั้งสถานะ assigned) แต่ยังกันด้วย Number.isInteger เผื่ออนาคต
  const actorId = Number(actorUid);
  if (newStatus === "assigned" && Number.isInteger(actorId)) patch.assigned_staff_id = actorId;
  if (newStatus === "closed") patch.closed_at = new Date().toISOString();

  const { data, error } = await db().from("cases").update(patch).eq("id", caseId).select().single();
  if (error) throw error;
  await logEvent(caseId, actorUid || "system", "status_changed", `${current.status} → ${newStatus}${note ? " — " + note : ""}`);
  return data;
}

export async function addInternalNote(caseId, actorUid, note) {
  const { data, error } = await db().from("cases").update({ internal_note: note, updated_at: new Date().toISOString() }).eq("id", caseId).select().single();
  if (error) throw error;
  await logEvent(caseId, actorUid, "note_added", note);
  return data;
}

/* แก้หมวดหมู่ย้อนหลัง (แนวคิดจาก Traffy Fondue "เปลี่ยนประเภทเรื่องแจ้ง") — เผื่อประชาชนเลือกหมวดผิดตอน
   ยื่นฟอร์ม เจ้าหน้าที่แก้ได้จากหน้ารายละเอียดเรื่อง ไม่กระทบสถานะ/ข้อมูลอื่นเลย */
export async function recategorize(caseId, actorUid, newCategory) {
  const CATEGORIES = ["scam", "debt", "inheritance", "labor", "divorce", "land", "criminal", "other"];
  if (!CATEGORIES.includes(newCategory)) throw new Error("หมวดไม่ถูกต้อง: " + newCategory);
  const current = await getCaseById(caseId);
  if (!current) throw new Error("ไม่พบเรื่องนี้");
  if (current.category === newCategory) return current;
  const { data, error } = await db().from("cases").update({ category: newCategory, updated_at: new Date().toISOString() }).eq("id", caseId).select().single();
  if (error) throw error;
  await logEvent(caseId, actorUid, "recategorized", `${current.category} → ${newCategory}`);
  return data;
}

/* เพิ่มไฟล์หลักฐานเข้าเรื่องเดิมหลังยื่นไปแล้ว (แนวคิดจาก Traffy Fondue — ไม่ต้องยื่นเรื่องใหม่)
   ผู้เรียก (api/form.js) ตรวจสิทธิ์ความเป็นเจ้าของ + สถานะยังไม่ปิด/ไม่ถอนเรื่องมาก่อนแล้วเสมอ */
export const MAX_TOTAL_EVIDENCE = 12; // เพดานรวมกันเผื่อทยอยแนบหลายรอบ (เดิมจำกัด 3 ไฟล์/ครั้งตอนยื่นครั้งแรก) · 2 ต.ค. 69 export ให้รับเรื่องทางแชตใช้เพดานเดียวกัน
// PostgreSQL array literal for an exact snapshot comparison (including commas/quotes/backslashes in paths).
function pathArrayLiteral(paths) {
  return "{" + paths.map((p) => '"' + String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"').join(",") + "}";
}

async function appendCaseFiles(caseId, field, newPaths, actor, action, requireOpen = false) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getCaseById(caseId);
    if (!current) throw new Error("ไม่พบเรื่องนี้");
    if (requireOpen && (current.status === "closed" || current.status === "withdrawn")) {
      throw new Error("เรื่องนี้ปิด/ยกเลิกแล้ว ไม่สามารถแนบหลักฐานเพิ่มได้");
    }
    const previous = current[field] || [];
    const merged = [...new Set([...previous, ...newPaths])].slice(0, MAX_TOTAL_EVIDENCE);
    const added = merged.filter((p) => !previous.includes(p)).length;
    if (merged.length === previous.length && merged.every((p, i) => p === previous[i])) return current;

    // Compare-and-swap the array and status in one UPDATE. A concurrent upload or case closure causes
    // zero updated rows; reload and recompute instead of overwriting another successful attachment.
    let query = db().from("cases").update({ [field]: merged, updated_at: new Date().toISOString() })
      .eq("id", caseId).eq("status", current.status);
    query = current[field] == null ? query.is(field, null) : query.eq(field, pathArrayLiteral(previous));
    const { data, error } = await query.select().maybeSingle();
    if (error) throw error;
    if (!data) continue;
    await logEvent(caseId, actor, action, `+${added} ไฟล์ (รวม ${merged.length})`);
    return data;
  }
  throw new Error("มีการแก้ไขเรื่องนี้พร้อมกัน กรุณาลองแนบไฟล์อีกครั้ง");
}

export async function addEvidenceFiles(caseId, newPaths) {
  return appendCaseFiles(caseId, "evidence_paths", newPaths, "citizen", "evidence_added", true);
}

/* เอกสาร/รูปผลการดำเนินการที่เจ้าหน้าที่แนบให้ประชาชนดู (แนวคิดจาก "รูปภาพดำเนินการ" ของ Traffy Fondue)
   เก็บแยกคอลัมน์จาก evidence_paths เพราะคนละความหมาย (หลักฐานจากประชาชน vs ผลงานจากเจ้าหน้าที่)
   ใช้บัคเก็ต Storage เดียวกัน (evidence) แค่คนละคอลัมน์อ้างอิง — ไม่ต้องมี bucket/นโยบายเพิ่ม */
export async function addResolutionFiles(caseId, actorUid, newPaths) {
  return appendCaseFiles(caseId, "resolution_paths", newPaths, actorUid, "resolution_added");
}

/* ═══ รับเรื่องทางแชต (2 ต.ค. 69) ═══
   latestOpenCaseOf: เรื่องล่าสุดของผู้ใช้ไลน์คนนี้ที่ยังเปิดอยู่ (ใช้โชว์ปุ่ม "➕ เพิ่มข้อมูลเข้าเรื่อง" ในการ์ดรับเรื่อง)
   addCitizenMessage: ข้อความที่ประชาชนพิมพ์เพิ่มในแชตแล้วกดเพิ่มเข้าเรื่องเดิม → ไทม์ไลน์ 'citizen_message' + ขยับ updated_at
   (แบบเดียวกับ addEvidenceFiles — ผู้เรียกตรวจเจ้าของเรื่อง/สถานะยังเปิดมาก่อนเสมอ) */
export const OPEN_STATUSES = ["new", "assigned", "in_progress", "need_info"];
export async function latestOpenCaseOf(uid) {
  if (!uid) return null;
  const { data, error } = await db().from("cases").select("id,case_no,status,created_at")
    .eq("citizen_line_uid", uid).in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data && data.length ? data[0] : null;
}
export async function addCitizenMessage(caseId, note) {
  // ⚠️ ไม่ใช้ logEvent() (กลืน error เงียบ) — ข้อความนี้คือเนื้อหาที่ประชาชนส่งมา บันทึกไม่ได้ต้อง throw ให้ผู้เรียกไม่ล้างร่างทิ้ง
  const { error: evErr } = await db().from("case_events").insert({ case_id: caseId, actor: "citizen", action: "citizen_message", note });
  if (evErr) throw evErr;
  const { data, error } = await db().from("cases").update({ updated_at: new Date().toISOString() }).eq("id", caseId).select().single();
  if (error) throw error;
  return data;
}

/* เพิ่มข้อความ+หลักฐานจากร่างแชตใน transaction เดียว และ idempotent ด้วย submissionId
   ต้องรัน migration-15 ก่อน หากยังไม่รันให้โยน error เพื่อคืนร่าง แทนการบันทึกครึ่งเดียว/ซ้ำ */
export async function appendChatSubmission(caseId, note, paths, submissionId) {
  if (!submissionId) throw new Error("ไม่พบรหัสการส่งข้อมูลจากแชต");
  const { data, error } = await db().rpc("append_chat_submission", {
    p_case_id: caseId,
    p_note: note || "(ไม่มีข้อความ)",
    p_paths: Array.isArray(paths) ? paths : [],
    p_submission_id: submissionId,
  });
  if (error) throw new Error("เพิ่มข้อมูลจากแชตไม่สำเร็จ: " + error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function notifyCitizenLogged(caseId, actorUid, messageSent) {
  await logEvent(caseId, actorUid, "notified_citizen", messageSent);
}

/* ให้คะแนนความพึงพอใจหลังปิดเรื่อง (แนวคิดจาก Traffy Fondue) — ประชาชนกดดาวเองผ่าน postback,
   ตรวจสิทธิ์ (citizen_line_uid ตรงกับ uid ที่กด) ทำที่ผู้เรียกใน line-webhook.js ก่อนเรียกฟังก์ชันนี้ */
export async function recordSatisfaction(caseId, rating) {
  const { data, error } = await db()
    .from("cases")
    .update({ satisfaction_rating: rating, satisfaction_rated_at: new Date().toISOString() })
    .eq("id", caseId)
    .select()
    .single();
  if (error) throw error;
  await logEvent(caseId, "citizen", "satisfaction_rated", `ให้คะแนนความพึงพอใจ ${rating} ดาว`);
  return data;
}

export async function countByStatus() {
  const { data, error } = await db().from("cases").select("status");
  if (error) throw error;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const row of data || []) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

/* สถิติสำหรับหน้าแดชบอร์ด — คำนวณจากผลลัพธ์ select เดียว (สเกลงานเล็ก ยังไม่ต้องมี RPC/materialized view) */
export async function dashboardStats() {
  // ลองดึง satisfaction_rating ก่อน — ถ้ายังไม่ได้รัน supabase-migration-3-satisfaction.sql คอลัมน์นี้
  // จะยังไม่มีจริงใน DB แล้ว select จะ error ทั้งคำสั่ง ต้อง fallback ไปดึงแบบไม่มีคอลัมน์นี้แทน กันแดชบอร์ด
  // เดิม (ที่ทำงานอยู่แล้วก่อนเพิ่มฟีเจอร์นี้) พังไปด้วยทั้งที่ไม่เกี่ยวกัน
  let rows, hasSatisfaction = true;
  {
    const { data, error } = await db().from("cases").select("category,status,created_at,closed_at,satisfaction_rating");
    if (error) {
      hasSatisfaction = false;
      const fallback = await db().from("cases").select("category,status,created_at,closed_at");
      if (fallback.error) throw fallback.error;
      rows = fallback.data || [];
    } else {
      rows = data || [];
    }
  }

  const dailyMap = {};
  const cutoff = Date.now() - 60 * 86400000; // เก็บ 60 วันย้อนหลัง พอให้รวมเป็นรายสัปดาห์ได้ ~8-9 แท่งที่ฝั่งไคลเอนต์
  for (const r of rows) {
    if (new Date(r.created_at).getTime() < cutoff) continue;
    const d = r.created_at.slice(0, 10);
    dailyMap[d] = (dailyMap[d] || 0) + 1;
  }
  const daily = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));

  const byCategory = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + 1;

  const closed = rows.filter((r) => r.status === "closed" && r.closed_at);
  const avgCloseDays = closed.length
    ? closed.reduce((sum, r) => sum + (new Date(r.closed_at) - new Date(r.created_at)), 0) / closed.length / 86400000
    : null;

  const rated = hasSatisfaction ? rows.filter((r) => r.satisfaction_rating) : [];
  const avgSatisfaction = rated.length ? rated.reduce((sum, r) => sum + r.satisfaction_rating, 0) / rated.length : null;

  // ═══ เพิ่ม 17 ก.ย. 69 — แนวคิดยืมจาก Traffy Fondue (สถิติแยกตามหมวด + KPI สรุปผล) ═══
  const withdrawnCount = rows.filter((r) => r.status === "withdrawn").length;
  const activeDenominator = rows.length - withdrawnCount; // ไม่นับเรื่องที่ผู้แจ้งยกเลิกเองเป็นตัวตั้ง (ไม่ใช่เรื่องที่เจ้าหน้าที่ต้องแก้)
  const resolutionRate = activeDenominator > 0 ? closed.length / activeDenominator : null;
  const overdueCount = rows.filter((r) =>
    r.status !== "closed" && r.status !== "withdrawn" && (Date.now() - new Date(r.created_at).getTime()) / 86400000 > 3
  ).length;

  const satByCat = {};
  if (hasSatisfaction) {
    for (const r of rated) {
      const b = (satByCat[r.category] ||= { sum: 0, count: 0 });
      b.sum += r.satisfaction_rating; b.count++;
    }
  }
  const satisfactionByCategory = Object.fromEntries(Object.entries(satByCat).map(([cat, b]) => [cat, b.sum / b.count]));

  const closeDaysByCat = {};
  for (const r of closed) {
    const b = (closeDaysByCat[r.category] ||= { sumDays: 0, count: 0 });
    b.sumDays += (new Date(r.closed_at) - new Date(r.created_at)) / 86400000; b.count++;
  }
  const closeDaysByCategory = Object.fromEntries(Object.entries(closeDaysByCat).map(([cat, b]) => [cat, b.sumDays / b.count]));

  return {
    daily, byCategory, avgCloseDays, avgSatisfaction, ratedCount: rated.length, totalCases: rows.length, closedCases: closed.length,
    withdrawnCount, resolutionRate, overdueCount, satisfactionByCategory, closeDaysByCategory,
  };
}

/* อันดับภาระงานเจ้าหน้าที่ (แนวคิดจาก Traffy Fondue "การปฏิบัติงานของเจ้าหน้าที่") — เฉพาะแอดมินดู
   (จำกัดสิทธิ์ที่ผู้เรียกใน api/staff.js) นับเฉพาะเรื่องที่มอบหมายแล้วเท่านั้น */
export async function staffWorkload() {
  // join ด้วย staff.id (เดิมใช้ line_uid ก่อนรอบ 3 ที่ย้ายไปล็อกอินอีเมล+รหัสผ่าน — เจ้าหน้าที่ไม่จำเป็น
  // ต้องมี LINE อีกต่อไป จึง assign เรื่องด้วย assigned_staff_id แทน assigned_staff_uid เดิม)
  const [{ data: staffRows }, { data: caseRows }] = await Promise.all([
    db().from("staff").select("id,display_name").eq("active", true),
    db().from("cases").select("assigned_staff_id,status"),
  ]);
  const map = {};
  for (const s of staffRows || []) map[s.id] = { name: s.display_name || `เจ้าหน้าที่ #${s.id}`, active: 0, closed: 0, total: 0 };
  for (const c of caseRows || []) {
    const bucket = c.assigned_staff_id && map[c.assigned_staff_id];
    if (!bucket) continue;
    bucket.total++;
    if (c.status === "closed") bucket.closed++;
    else if (c.status !== "withdrawn") bucket.active++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}
