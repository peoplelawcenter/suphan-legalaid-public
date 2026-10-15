/* api/_mailer.js — แจ้งเจ้าหน้าที่ทางอีเมล (ช่องทางที่สองตามมติเจ้าของ "ทั้งสองทาง")
   ใช้ Gmail SMTP ด้วย App Password ของ peoplelaw.center@gmail.com เอง (ฟรี ไม่ต้องพึ่งผู้ให้บริการอื่น
   — ยังไม่ยืนยันจากเจ้าของว่าจะใช้อีเมลนี้หรืออีเมลอื่น ดู SPEC.md ข้อ 13.3)
   ตั้งค่าที่ต้องมี: MAIL_USER (อีเมลผู้ส่ง), MAIL_APP_PASSWORD (App Password 16 ตัว ไม่ใช่รหัสผ่านจริง) */
import nodemailer from "nodemailer";
import { isChatCase } from "./_cases.js";

let _transporter = null;
function transporter() {
  if (_transporter) return _transporter;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("ยังไม่ตั้ง MAIL_USER / MAIL_APP_PASSWORD");
  _transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  return _transporter;
}

/* ส่งไม่สำเร็จต้อง "ไม่ทำให้งานหลักล้ม" (ห้ามพังเงียบแบบไม่รู้ตัว แต่ก็ห้ามให้อีเมลพังแล้วเรื่องหาย)
   คืน true/false เสมอ ให้ผู้เรียก log เอง ไม่ throw ทะลุขึ้นไป */
export async function sendMail({ to, subject, text }) {
  if (!to || !to.length) return true;
  try {
    await transporter().sendMail({
      from: `"ศูนย์ช่วยเหลือประชาชนทางกฎหมาย" <${process.env.MAIL_USER}>`,
      to: Array.isArray(to) ? to.join(",") : to,
      subject,
      text,
    });
    return true;
  } catch (e) {
    console.error("sendMail failed", e);
    return false;
  }
}

const CASE_LABEL_TH = { consult: "คำขอปรึกษาข้อกฎหมาย", complaint: "เรื่องร้องเรียน", appointment: "คำขอจองคิวทนายอาสา" };
export function caseNotifyMailText(caseRow) {
  const label = CASE_LABEL_TH[caseRow.case_type] || "เรื่องใหม่";
  return [
    `มี${label}ใหม่ เลขที่ ${caseRow.case_no}`,
    ``,
    `ชื่อผู้ติดต่อ: ${caseRow.citizen_name || "(ไม่ประสงค์ออกนาม)"}`,
    `เบอร์โทร: ${caseRow.citizen_phone || "-"}`,
    `หมวด: ${caseRow.category}`,
    // 30 ก.ย. 69: เวลา HH:MM (migration-12) ถ้ามี ไม่งั้นช่วงเช้า/บ่ายแบบเดิม · อำเภอ · ช่องทางเว็บ (ไม่มีไลน์ ต้องโทรกลับ)
    caseRow.case_type === "appointment" && caseRow.preferred_date
      ? `วัน-เวลาที่ขอนัด: ${caseRow.preferred_date} (${caseRow.preferred_time ? caseRow.preferred_time + " น." : caseRow.preferred_time_slot === "morning" ? "ช่วงเช้า" : "ช่วงบ่าย"})`
      // 2 ต.ค. 69: ขอนัดพบทนายอาสาจากแชตไลน์ไม่มีวัน-เวลา — เจ้าหน้าที่ต้องนัดเอง
      : caseRow.case_type === "appointment" ? `วัน-เวลาที่ขอนัด: ยังไม่ระบุ — ${caseRow.citizen_phone ? "กรุณาโทรนัดวัน-เวลา" : "กรุณานัดผ่านปุ่ม \"แจ้งผลประชาชน\" ในหลังบ้าน (ไม่มีเบอร์)"}` : null,
    caseRow.citizen_district ? `อำเภอที่อยู่: ${caseRow.citizen_district}` : null,
    caseRow.case_type === "appointment" && !caseRow.citizen_line_uid ? `ช่องทาง: ยื่นผ่านเว็บไซต์ (ไม่มีไลน์ — ติดต่อกลับทางโทรศัพท์เท่านั้น)` : null,
    // 2 ต.ค. 69 รับเรื่องทางแชต: ประชาชนพิมพ์เล่าในแชตแล้วกดส่ง (ไม่ได้กรอกแบบฟอร์ม — รายละเอียดเรียงตามเวลาที่พิมพ์)
    isChatCase(caseRow) ? `ช่องทาง: 💬 แจ้งทางแชตไลน์ (ไม่ได้กรอกแบบฟอร์ม — ชื่อมาจากโปรไฟล์ไลน์)` : null,
    `รายละเอียด: ${caseRow.detail}`,
    caseRow.respondent ? `ผู้ถูกร้อง/หน่วยงานที่เกี่ยวข้อง: ${caseRow.respondent}` : null,
    ``,
    `เข้าดูรายละเอียด/มอบหมาย/เปลี่ยนสถานะได้ที่หน้าเว็บหลังบ้าน: ${process.env.SITE_URL || "https://suphan-legalaid.vercel.app"}/staff.html`,
  ].filter(Boolean).join("\n");
}
