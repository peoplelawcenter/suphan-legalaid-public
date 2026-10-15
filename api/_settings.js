/* api/_settings.js — ค่าตั้งค่าที่แอดมินแก้เองได้จากไลน์ (#ตั้งค่า) ไม่ต้องแก้โค้ด/deploy ใหม่
   เก็บในตาราง settings (key/value jsonb) อ่านทั้งหมดครั้งเดียวแล้ว cache สั้นๆ กันยิง DB รัวทุกข้อความ */
import { db } from "./_db.js";

export const DEFAULTS = {
  office_hours: { days: "จันทร์–ศุกร์", start: "08:30", end: "16:30" },
  // 2 ต.ค. 69 บอสสั่งเปลี่ยนเบอร์ศูนย์ (เดิม 0 3552 5500 = เบอร์กลาง อบจ.) · แสดงแบบนี้ กดโทร tel:035431751
  phone: "035-431-751",
  // ⛔⛔ บั๊กจริง 16 ก.ย. 69 — เดิมใส่ภาษาไทยดิบในนี้ ไม่ผ่าน encode ก่อนใส่ uri action ของปุ่ม "ดูแผนที่"
  // LINE ตอบ 400 "Invalid action URI" ตีกลับทั้งข้อความเงียบๆ (กดปุ่ม "ติดต่อเรา" แล้วบอทไม่ตอบอะไรเลย)
  // ต้อง encodeURIComponent ส่วนที่ไม่ใช่ ASCII เสมอ — assertFlexSafe() ใน _lineapi.js ดักไว้แล้ว
  // 30 ก.ย. 69 (บอสสั่ง "ปักหมุด google map พิกัดให้ด้วย"): เปลี่ยนจากค้นชื่อหน่วยงาน เป็นหมุดพิกัดจริงของ อบจ.สุพรรณบุรี
  // = พิกัดเดียวกับปุ่ม "ขอเส้นทาง" บนเว็บทางการ suphan.go.th และ APPOINTMENT_INFO.location ใน _serviceinfo.js (ASCII ล้วน)
  map_url: "https://www.google.com/maps/search/?api=1&query=14.463944178464498,100.13254896002172",
  // ผู้ตอบจริงยังไม่ฟันธง (เจ้าของ 15 ก.ย. 69: "ยืดหยุ่นๆ ยังบอกไม่ได้") — ทุกการ์ดอ้างคำนี้แทนชื่อ
  // หน่วยงาน/ตำแหน่งตรงๆ เปลี่ยนได้ทันทีด้วย #ตั้งค่า เมื่อเจ้าของตัดสินใจแล้ว
  responder_label: "เจ้าหน้าที่",
  // ปุ่มจองคิวทนายอาสา — เปิดแล้ว 16 ก.ย. 69 (เจ้าของสั่งให้ตรงภาพต้นแบบ 100% ทับมติเดิม 15 ก.ย. ที่ปิดไว้)
  // ⚠️ กระบวนการจองคิวจริงยังไม่มี (ดู SPEC.md ข้อ 13.4) — กดแล้วยังส่งเข้า flow ฝากเรื่องปรึกษาแทน
  appointment_enabled: true,
  // วันหยุดราชการ (พ.ศ.-ค.ศ. ผสมได้ เก็บเป็น ISO date) — แอดมินอัปเดตปีต่อปีเอง ไม่มีปฏิทินอัตโนมัติ
  holidays: [],
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 60 * 1000;

export async function getSettings() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const { data, error } = await db().from("settings").select("key,value");
    if (error) throw error;
    const merged = { ...DEFAULTS };
    for (const row of data || []) merged[row.key] = row.value;
    cache = merged;
    cacheAt = Date.now();
    return merged;
  } catch (e) {
    console.error("getSettings failed, ใช้ค่า default", e);
    return { ...DEFAULTS };
  }
}

export async function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`ไม่รู้จักคีย์ตั้งค่า "${key}"`);
  const { error } = await db().from("settings").upsert({ key, value });
  if (error) throw error;
  cache = null; // บังคับอ่านใหม่รอบหน้า
  return true;
}

export function isOfficeHoursNow(settings, now = new Date()) {
  // เทียบเวลา Asia/Bangkok เสมอ ไม่ว่า Vercel function จะรันอยู่ timezone ไหน
  const bkk = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const day = bkk.getDay(); // 0=อาทิตย์
  if (day === 0 || day === 6) return false;
  const iso = bkk.toISOString().slice(0, 10);
  if ((settings.holidays || []).includes(iso)) return false;
  const hhmm = bkk.getHours() * 60 + bkk.getMinutes();
  const [sh, sm] = settings.office_hours.start.split(":").map(Number);
  const [eh, em] = settings.office_hours.end.split(":").map(Number);
  return hhmm >= sh * 60 + sm && hhmm <= eh * 60 + em;
}
