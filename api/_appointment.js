/* api/_appointment.js — กติกากลางของ "แบบคำร้องขอเข้ารับคำปรึกษาทางกฎหมาย" (public/appointment.html)
   เพิ่ม 30 ก.ย. 69 (บอสสั่ง: ฟอร์มแบบ e-service ของเว็บ อบจ. suphan.go.th/eservice/cctv มีวันที่ เวลา
   เรื่องที่ขอรับคำปรึกษา — กดใช้ได้ทั้งบนเว็บและใน LINE OA) ทับฟอร์มจองคิวแบบง่ายเดิม 17 ก.ย. 69
   (เดิมเลือกแค่ "ช่วงเช้า/บ่าย" + ชื่อ-นามสกุลช่องเดียว)

   ไฟล์นี้เป็น "สูตรเดียว" ของชุดวัน/เวลา/ฟิลด์ที่อนุญาต — หน้าเว็บดึงตัวเลือกทั้งหมดจาก
   `api/form.js?action=appt-config` (ไม่เขียนรายการซ้ำใน HTML) และเซิร์ฟเวอร์ตรวจซ้ำด้วยฟังก์ชันชุดเดียวกัน
   ตอนรับเรื่อง กันหน้าเว็บกับเซิร์ฟเวอร์เห็นวันไม่ตรงกัน (บั๊กเดิม: หน้าเว็บคำนวณวันเองด้วย
   toISOString() ในเบราว์เซอร์เวลาไทย ได้ค่าวันที่เลื่อนไป 1 วันจากป้ายที่โชว์)

   ⛔ มติบอส 30 ก.ย. 69 (ห้ามเปลี่ยนเองโดยไม่ถาม):
   - ฟิลด์เท่าที่จำเป็น (PDPA): คำนำหน้า ชื่อ นามสกุล เบอร์โทร อำเภอที่อยู่ วัน เวลา หมวดเรื่อง+รายละเอียด
     ยินยอม PDPA — **ห้ามเก็บเลขบัตรประชาชน อายุ หรือที่อยู่เต็ม** (validateAppointment คืนเฉพาะฟิลด์ที่
     ประกาศไว้ ช่องอื่นที่ใครยิงมาถูกทิ้งหมด)
   - เวลา: รายชั่วโมงเว้นพักเที่ยง 09:00/10:00/11:00/13:00/14:00/15:00
   - วัน: 14 วันทำการถัดไป ข้ามเสาร์-อาทิตย์ + settings.holidays (ตรรกะเดิม)
   ไฟล์นี้ไม่แตะ DB — ทดสอบออฟไลน์ได้ทั้งไฟล์ (scripts/test-appointment.mjs) */

export const APPT_TIMES = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00"];
export const APPT_WORKING_DAYS = 14;

export const TITLES = ["นาย", "นาง", "นางสาว", "อื่นๆ"];

// 10 อำเภอของ จ.สุพรรณบุรี + นอกจังหวัด (เก็บแค่อำเภอ ไม่เก็บที่อยู่เต็ม — มติบอส PDPA)
export const DISTRICTS = [
  "เมืองสุพรรณบุรี", "เดิมบางนางบวช", "ด่านช้าง", "บางปลาม้า", "ศรีประจันต์",
  "ดอนเจดีย์", "สองพี่น้อง", "สามชุก", "อู่ทอง", "หนองหญ้าไซ", "นอกจังหวัด",
];

// หมวดเรื่องตามหมวดเดิมของระบบ (ชุดเดียวกับ recategorize() ใน _cases.js และ CATEGORY_TH ใน staff.html)
export const CATEGORY_OPTIONS = [
  { value: "scam", label: "ถูกโกง / มิจฉาชีพ" },
  { value: "debt", label: "หนี้สิน / ถูกทวงหนี้" },
  { value: "inheritance", label: "มรดก / พินัยกรรม" },
  { value: "labor", label: "จ้างงาน / แรงงาน" },
  { value: "divorce", label: "หย่า / ครอบครัว" },
  { value: "land", label: "ที่ดิน / บ้าน" },
  { value: "criminal", label: "อุบัติเหตุ / คดีอาญา" },
  { value: "other", label: "อื่นๆ" },
];

// เพดานความยาวทุกช่อง (หน้าเว็บใช้ค่าเดียวกันเป็น maxlength — เซิร์ฟเวอร์ตรวจซ้ำเสมอ)
export const FIELD_LIMITS = { titleOther: 30, firstName: 60, lastName: 60, phoneRaw: 20, detail: 500 };

/* ═══ กันสแปมโหมดเว็บ (ไม่มีลิงก์ ?k= จากไลน์) — ค่าคงที่ปรับได้ที่นี่ที่เดียว ═══
   perIpHour/perIpDay นับจากแฮช HMAC(ip+วันที่) ไม่เก็บ IP ดิบ · globalDay = เพดานรวมเรื่องจากเว็บต่อวัน
   (ตั้ง env APPT_WEB_DAILY_CAP ทับได้โดยไม่ต้องแก้โค้ด) · minFillMs = เวลากรอกขั้นต่ำนับจากเปิดหน้า
   (บอทยิงทันทีจะไม่ผ่าน) · maxFillMs = หน้าเปิดค้างนานเกินนี้ต้องโหลดใหม่ (กันเก็บตราเวลาไว้ยิงทีหลัง) */
export const WEB_LIMITS = { perIpHour: 3, perIpDay: 10, globalDay: 30 };
export const WEB_FORM_TIMING = { minFillMs: 4000, maxFillMs: 6 * 60 * 60 * 1000 };

export function webLimits() {
  const cap = Number(process.env.APPT_WEB_DAILY_CAP);
  return { ...WEB_LIMITS, globalDay: Number.isInteger(cap) && cap > 0 ? cap : WEB_LIMITS.globalDay };
}

const DAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const MONTH_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/* วันนี้ตามเวลาไทยเป็น "YYYY-MM-DD" — ไม่พึ่ง timezone ของเครื่องที่รัน (Vercel = UTC, เบราว์เซอร์ = ไทย) */
export function bkkTodayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/* เวลาเริ่มวันตามเวลาไทยเป็น ISO UTC — ใช้นับ "เรื่องจากเว็บวันนี้" */
export function bkkDayStartUtcIso(dayIso) {
  return new Date(`${dayIso}T00:00:00+07:00`).toISOString();
}

function isoToUtcDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === iso ? d : null; // กัน 2026-02-31 ที่ Date เลื่อนเป็นเดือนถัดไปเงียบๆ
}

/* ป้ายวันที่ภาษาไทยแบบ พ.ศ. เช่น "พฤหัสบดี 1 ต.ค. 2569" */
export function thaiDateLabel(iso) {
  const d = isoToUtcDate(iso);
  if (!d) return String(iso || "");
  return `${DAY_TH[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_TH[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;
}

/* 14 วันทำการถัดไป (เริ่มพรุ่งนี้) ข้ามเสาร์-อาทิตย์และวันหยุดใน settings.holidays — คิดแบบวันปฏิทินล้วน
   (UTC arithmetic) ไม่มีเรื่อง timezone มาปน */
export function allowedApptDates(todayIso, holidays = [], count = APPT_WORKING_DAYS) {
  const start = isoToUtcDate(todayIso);
  if (!start) return [];
  const off = new Set(Array.isArray(holidays) ? holidays.map(String) : []);
  const out = [];
  for (let i = 1; out.length < count && i < 60; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const day = d.getUTCDay();
    if (day === 0 || day === 6 || off.has(iso)) continue;
    out.push({ iso, label: thaiDateLabel(iso) });
  }
  return out;
}

/* preferred_time_slot เดิม (CHECK 'morning'|'afternoon') ยังบันทึกคู่เสมอให้ของเดิมไม่พัง — ก่อน 12:00 = เช้า */
export function timeSlotOf(hhmm) {
  return String(hhmm) < "12:00" ? "morning" : "afternoon";
}

function cleanLine(v) {
  return String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}
function cleanMultiline(v) {
  return String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

/* เบอร์ไทย: ตัดขีด/ช่องว่าง, +66 → 0 แล้วต้องเป็น 0 + 8–9 หลัก (บ้าน 9 หลัก / มือถือ 10 หลัก) */
export function normalizePhone(raw) {
  const s = String(raw ?? "");
  if (s.length > FIELD_LIMITS.phoneRaw) return null;
  let p = s.replace(/[\s\-().]/g, "");
  if (p.startsWith("+66")) p = "0" + p.slice(3);
  return /^0\d{8,9}$/.test(p) ? p : null;
}

const fail = (field, error) => ({ ok: false, field, error });

/* ตรวจแบบคำร้องทั้งใบ — คืนเฉพาะฟิลด์ที่อนุญาต (ช่องอื่นที่ส่งมาถูกทิ้ง เช่น idCard/age/address) */
export function validateAppointment(body, { todayIso, holidays = [] } = {}) {
  const b = body && typeof body === "object" ? body : {};

  const title = cleanLine(b.title);
  if (!TITLES.includes(title)) return fail("title", "กรุณาเลือกคำนำหน้า");
  let titleText = title;
  if (title === "อื่นๆ") {
    titleText = cleanLine(b.titleOther);
    if (!titleText) return fail("titleOther", "กรุณาระบุคำนำหน้า");
    if (titleText.length > FIELD_LIMITS.titleOther) return fail("titleOther", `คำนำหน้ายาวเกิน ${FIELD_LIMITS.titleOther} ตัวอักษร`);
  }

  const firstName = cleanLine(b.firstName);
  if (!firstName) return fail("firstName", "กรุณากรอกชื่อ");
  if (firstName.length > FIELD_LIMITS.firstName) return fail("firstName", `ชื่อยาวเกิน ${FIELD_LIMITS.firstName} ตัวอักษร`);
  const lastName = cleanLine(b.lastName);
  if (!lastName) return fail("lastName", "กรุณากรอกนามสกุล");
  if (lastName.length > FIELD_LIMITS.lastName) return fail("lastName", `นามสกุลยาวเกิน ${FIELD_LIMITS.lastName} ตัวอักษร`);

  const phone = normalizePhone(b.phone);
  if (!phone) return fail("phone", "กรุณากรอกหมายเลขโทรศัพท์ให้ถูกต้อง (เช่น 0812345678)");

  const district = cleanLine(b.district);
  if (!DISTRICTS.includes(district)) return fail("district", "กรุณาเลือกอำเภอที่อยู่");

  const preferredDate = cleanLine(b.preferredDate);
  if (!preferredDate) return fail("preferredDate", "กรุณาเลือกวันที่ขอเข้ารับคำปรึกษา");
  const allowed = allowedApptDates(todayIso, holidays).map((d) => d.iso);
  if (!allowed.includes(preferredDate)) {
    return fail("preferredDate", "วันที่เลือกไม่อยู่ในช่วงที่เปิดรับ (14 วันทำการถัดไป) กรุณาโหลดหน้าใหม่แล้วเลือกวันอีกครั้ง");
  }

  const preferredTime = cleanLine(b.preferredTime);
  if (!APPT_TIMES.includes(preferredTime)) return fail("preferredTime", "กรุณาเลือกเวลาที่ขอเข้ารับคำปรึกษา");

  const category = cleanLine(b.category);
  if (!CATEGORY_OPTIONS.some((c) => c.value === category)) return fail("category", "กรุณาเลือกเรื่องที่ขอรับคำปรึกษา");

  const detail = cleanMultiline(b.detail);
  if (!detail) return fail("detail", "กรุณากรอกรายละเอียดเรื่องที่ขอรับคำปรึกษาโดยย่อ");
  if (detail.length > FIELD_LIMITS.detail) return fail("detail", `รายละเอียดยาวเกิน ${FIELD_LIMITS.detail} ตัวอักษร`);

  if (b.pdpaConsent !== true) return fail("pdpa", "กรุณายอมรับข้อตกลงการใช้ข้อมูลส่วนบุคคล");

  // "นาย/นาง/นางสาว" ต่อติดชื่อตามแบบฟอร์มราชการ · คำนำหน้าอื่น (เช่น ว่าที่ ร.ต.) เว้นวรรค
  const citizenName = `${title === "อื่นๆ" ? titleText + " " : titleText}${firstName} ${lastName}`;
  return {
    ok: true,
    value: {
      citizenName, phone, district, category, detail,
      preferredDate, preferredTime, preferredTimeSlot: timeSlotOf(preferredTime),
    },
  };
}

/* ตัดสินเพดานโหมดเว็บจากจำนวนที่ "ยื่นสำเร็จไปแล้ว" — ข้อความสุภาพชวนโทรศูนย์แทน (ไม่ใช่ error แข็งๆ) */
export function webQuotaVerdict({ ipHour = 0, ipDay = 0, globalDay = 0 } = {}, limits = WEB_LIMITS, phone = "") {
  const call = phone ? `กรุณาโทร ${phone} ในวันและเวลาราชการ` : "กรุณาโทรติดต่อศูนย์ในวันและเวลาราชการ";
  if (globalDay >= limits.globalDay) {
    return { ok: false, code: "web_daily_cap", error: `ขออภัย วันนี้มีผู้ยื่นแบบคำร้องผ่านเว็บไซต์ครบจำนวนที่รับได้แล้ว ${call} เจ้าหน้าที่ยินดีช่วยนัดหมายให้` };
  }
  if (ipDay >= limits.perIpDay || ipHour >= limits.perIpHour) {
    return { ok: false, code: "web_ip_limit", error: `ขออภัย มีการยื่นแบบคำร้องจากเครือข่ายของท่านหลายครั้งแล้ว ${call} หรือลองใหม่ภายหลัง` };
  }
  return { ok: true };
}

export function apptClosedMessage(phone) {
  return `ขณะนี้ศูนย์ปิดรับแบบคำร้องขอเข้ารับคำปรึกษาชั่วคราว${phone ? ` กรุณาโทร ${phone}` : " กรุณาโทรติดต่อศูนย์"} ในวันและเวลาราชการ`;
}
