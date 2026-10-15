/* api/_notify.js — แจ้งเจ้าหน้าที่เมื่อมีเรื่องใหม่/ข้อมูลเพิ่มในเรื่องเดิม (ใช้ร่วม form.js + line-webhook.js)
   2 ต.ค. 69: ย้าย notifyStaff/notifyEvidenceAdded ออกจาก api/form.js มาไว้ที่นี่ที่เดียว เพราะ "รับเรื่องทางแชต"
   (line-webhook.js) ต้องแจ้งเจ้าหน้าที่แบบเดียวกับฟอร์มเว็บทุกอย่าง — ห้ามเขียนสูตรแจ้งเตือนซ้ำที่จุดอื่น
   ⚠️ ผู้เรียกต้อง await ทุกฟังก์ชันก่อนตอบ HTTP response เสมอ (Vercel อาจตัดงานที่ค้างหลังส่ง response —
   ผู้ใช้เห็น "ส่งสำเร็จ" แต่เจ้าหน้าที่ไม่ได้รับแจ้งจริง) · error ภายในจับไว้แล้ว ไม่ทำให้งานหลักล้ม */
import { push, pushAllowed } from "./_lineapi.js";
import { sendMail, caseNotifyMailText } from "./_mailer.js";
import { notifiableStaff } from "./_staffauth.js";
import { citizenLineTarget, isChatCase } from "./_cases.js";

const CASE_TYPE_TH = { consult: "ปรึกษาข้อกฎหมาย", complaint: "ร้องเรียน", appointment: "จองคิวทนายอาสา" };

function staffUrl() {
  return `${process.env.SITE_URL || "https://suphan-legalaid.vercel.app"}/staff.html`;
}

/* ข้อความแจ้งเตือนเรื่องใหม่ทางไลน์ (ฟังก์ชันบริสุทธิ์ — scripts/test-chatintake.mjs ตรวจได้)
   30 ก.ย. 69: โชว์เวลา HH:MM ถ้ามี (migration-12) ไม่งั้นช่วงเช้า/บ่ายแบบเดิม + บอกชัดถ้ายื่นผ่านเว็บ (โทรกลับเท่านั้น)
   2 ต.ค. 69: เรื่องจากแชต บอกช่องทาง "💬 แจ้งทางแชตไลน์" · จองคิวจากแชตไม่มีวัน-เวลา = "ยังไม่ระบุ — โทรนัด" */
export function staffNewCaseText(caseRow) {
  const isAppt = caseRow.case_type === "appointment";
  const chat = isChatCase(caseRow);
  let apptLine = "";
  if (isAppt && caseRow.preferred_date) {
    apptLine = `\nวันที่ขอนัด: ${caseRow.preferred_date} (${caseRow.preferred_time ? caseRow.preferred_time + " น." : caseRow.preferred_time_slot === "morning" ? "เช้า" : "บ่าย"})`
      + (citizenLineTarget(caseRow) ? "" : "\nช่องทาง: ยื่นผ่านเว็บ (ไม่มีไลน์ — ติดต่อกลับทางโทรศัพท์)");
  } else if (isAppt) {
    apptLine = `\nวันที่ขอนัด: ยังไม่ระบุ — ${caseRow.citizen_phone ? "โทรนัดวัน-เวลา" : "นัดผ่านปุ่มแจ้งผลประชาชน (ไม่มีเบอร์)"}`;
  }
  const chatLine = chat ? `\nช่องทาง: 💬 แจ้งทางแชตไลน์${caseRow.citizen_phone ? "" : " (ไม่ได้ให้เบอร์ — ติดต่อกลับผ่านปุ่มแจ้งผลประชาชน)"}` : "";
  return `📌 เรื่องใหม่ ${caseRow.case_no}\nประเภท: ${CASE_TYPE_TH[caseRow.case_type] || caseRow.case_type}\nหมวด: ${caseRow.category}${apptLine}${chatLine}\nดูรายละเอียดที่หน้าเว็บหลังบ้าน: ${staffUrl()}`;
}

export async function notifyStaff(caseRow) {
  // เฉพาะเจ้าหน้าที่ที่รับแจ้งเตือนหมวดนี้ (แนวคิดจาก Traffy Fondue ตั้งค่าการแจ้งเตือนต่อหมวด เพิ่ม 17 ก.ย. 69)
  const list = await notifiableStaff(caseRow.category);

  // ⛔ 17 ก.ย. 69 รอบ 3: เจ้าหน้าที่ไม่บังคับมี LINE อีกต่อไป (ย้ายไปล็อกอินเว็บด้วยอีเมล+รหัสผ่าน) —
  // ส่ง LINE push เฉพาะคนที่ผูกบัญชีไว้แบบไม่บังคับ (#เชื่อม ใน line-webhook.js) เท่านั้น อีเมลเป็นช่องหลัก
  const lineTargets = list.filter((s) => s.notify_line && s.line_uid).map((s) => s.line_uid);
  if (lineTargets.length && (await pushAllowed("urgent"))) {
    const text = staffNewCaseText(caseRow);
    // ⚠️ ต้อง await ทุกตัวก่อนฟังก์ชันนี้ return (ผู้เรียก notifyStaff() ก็ await อยู่แล้ว) — ถ้าไม่ await
    // ตรงนี้ ฟังก์ชันจะ resolve ทันทีโดยไม่รอ push จริงส่งเสร็จ แล้ว Vercel อาจตัดตอนก่อนส่งจริงสำเร็จ
    await Promise.all(lineTargets.map((uid) => push(uid, { type: "text", text }).catch((e) => console.error("staff push failed", uid, e))));
  }

  const emailTargets = list.filter((s) => s.notify_email && s.email).map((s) => s.email);
  if (emailTargets.length) {
    // ⚠️ sendMail() throw ถ้ายังไม่ตั้ง MAIL_APP_PASSWORD (ยังไม่ได้ตั้งจริง ณ 16 ก.ย. 69) — ต้อง catch
    // เอง ไม่งั้นถ้าเพิ่มโค้ดต่อท้ายฟังก์ชันนี้ในอนาคตจะไม่ทำงานเลยเพราะ throw ตัดตอนก่อนถึง (LINE push
    // ด้านบนส่งไปแล้วสำเร็จอยู่ดี เพราะ .catch() ต่อ push แต่ละอันแยกกันไว้แล้ว)
    await sendMail({
      to: emailTargets,
      subject: `[ศูนย์ช่วยเหลือประชาชนทางกฎหมาย] เรื่องใหม่ ${caseRow.case_no}`,
      text: caseNotifyMailText(caseRow),
    }).catch((e) => console.error("sendMail failed", e));
  }
}

/* แจ้งเจ้าหน้าที่เมื่อประชาชนเพิ่มข้อมูลเข้าเรื่องเดิม — LINE และอีเมลตามช่องทางที่แต่ละคนเปิดไว้
   ให้เจ้าหน้าที่ผู้รับผิดชอบโดยตรงถ้ามอบหมายแล้ว ไม่งั้นแจ้งทุกคนที่รับแจ้งเตือนหมวดนี้
   2 ต.ค. 69: แยกตัวส่งกลาง notifyCaseUpdate() ให้ "ข้อความเพิ่มเติมจากแชต" ใช้ร่วมกับ "แนบหลักฐานเพิ่ม" */
export async function notifyCaseUpdate(caseRow, text) {
  const eligible = await notifiableStaff(caseRow.category);
  const recipients = caseRow.assigned_staff_id
    ? eligible.filter((s) => s.id === caseRow.assigned_staff_id)
    : eligible;
  const lineTargets = recipients.filter((s) => s.notify_line && s.line_uid).map((s) => s.line_uid);
  if (lineTargets.length && (await pushAllowed("normal"))) {
    await Promise.all(lineTargets.map((uid) => push(uid, { type: "text", text }).catch((e) => console.error("case update push failed", uid, e))));
  }
  const emailTargets = recipients.filter((s) => s.notify_email && s.email).map((s) => s.email);
  if (emailTargets.length) {
    await sendMail({
      to: emailTargets,
      subject: `[ศูนย์ช่วยเหลือประชาชนทางกฎหมาย] มีข้อมูลเพิ่มเติมในเรื่อง ${caseRow.case_no}`,
      text: `${text}\n\nเปิดเรื่องในระบบเจ้าหน้าที่: ${staffUrl()}`,
    }).catch((e) => console.error("case update email failed", e));
  }
}

export async function notifyEvidenceAdded(caseRow) {
  await notifyCaseUpdate(caseRow, `📎 มีหลักฐานเพิ่มเติมในเรื่อง ${caseRow.case_no} (รวม ${(caseRow.evidence_paths || []).length} ไฟล์)`);
}
