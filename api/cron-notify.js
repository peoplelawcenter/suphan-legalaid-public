/* api/cron-notify.js — cron รายวัน 08:00 น. เวลาไทย (ตั้ง "0 1 * * *" UTC ใน vercel.json)
   1) สรุปจำนวนเรื่องค้าง (แยกสถานะ) ส่งอีเมล + LINE ให้แอดมิน ก่อนเริ่มวันทำการ
   2) เตือนเจ้าหน้าที่รายบุคคลที่มีเรื่องค้างนาน >3 วันไม่มีความเคลื่อนไหว (เพิ่ม 18 ก.ย. 69 — แนวคิด SLA
      escalation จาก Traffy Fondue) ต่างจากข้อ 1 ที่เป็นสรุปรวมส่งแอดมิน อันนี้ส่งตรงถึงเจ้าของเรื่องเอง
   3) ผลพลอยได้: คำสั่งนี้ยิง DB (countByStatus) อยู่แล้ว ช่วยกัน Supabase free plan pause โปรเจกต์
      (ไม่มีกิจกรรม DB เกิน 7 วัน) — ไม่ต้องเขียน cron แยกสำหรับเรื่องนี้
   4) (2 ต.ค. 69) ลบร่าง "รับเรื่องทางแชต" ที่หมดอายุ + ไฟล์ของร่าง (purge() ใน api/_chatintake.js)

   ยืนยันแล้ว 15 ก.ย. 69 จากเอกสาร Vercel: Vercel ส่ง header
   `Authorization: Bearer $CRON_SECRET` มาเองโดยอัตโนมัติทุกครั้งที่ trigger cron ถ้าตั้ง env
   CRON_SECRET ไว้ — ใช้ตรวจว่าคำขอนี้มาจาก Vercel cron จริง ไม่ใช่ใครก็ยิงเข้ามาได้

   ⚠️ ข้อ 2 ใช้ cron รายวันเดิม ไม่เพิ่ม cron ใหม่ใน vercel.json — Vercel Hobby cron รันได้แค่วันละครั้ง/
   ตัวอยู่แล้ว เตือน SLA วันละครั้งก็พอเหมาะพอดีกับข้อจำกัดนี้ */
import { countByStatus, isMissingTableError } from "./_cases.js";
import { createChatIntake } from "./_chatintake.js";
import { db } from "./_db.js";
import { push, pushAllowed } from "./_lineapi.js";
import { sendMail } from "./_mailer.js";

const CASE_TYPE_TH = { consult: "ปรึกษาข้อกฎหมาย", complaint: "ร้องเรียน", appointment: "จองคิวทนายอาสา" };
const STALE_DAYS = 3;

function daysAgo(iso) {
  return Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)));
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send("unauthorized");
  }

  try {
    const counts = await countByStatus();
    const openTotal = counts.new + counts.assigned + counts.in_progress + counts.need_info;
    const summary = [
      `สรุปเรื่องค้าง ณ วันนี้:`,
      `รอมอบหมาย: ${counts.new} · มอบหมายแล้ว: ${counts.assigned} · กำลังดำเนินการ: ${counts.in_progress} · รอข้อมูลเพิ่ม: ${counts.need_info}`,
      `รวมเรื่องค้างทั้งหมด: ${openTotal} เรื่อง (ปิดแล้ว ${counts.closed} เรื่อง)`,
    ].join("\n");

    const { data: staffList } = await db().from("staff").select("line_uid,email,role,notify_line,notify_email").eq("active", true);
    const admins = (staffList || []).filter((s) => s.role === "admin");

    if (openTotal > 0) {
      // เจ้าหน้าที่ไม่บังคับมี LINE อีกต่อไป (17 ก.ย. 69 รอบ 3) — ส่งเฉพาะแอดมินที่ผูกบัญชีไว้แบบไม่บังคับ
      const lineTargets = admins.filter((s) => s.notify_line && s.line_uid).map((s) => s.line_uid);
      if (lineTargets.length && (await pushAllowed("normal"))) {
        // ต้อง await ให้ครบก่อนตอบ response (เหมือนบทเรียนใน form.js) ไม่งั้น Vercel อาจตัดตอนก่อน
        // push จริงส่งเสร็จ แล้วแอดมินไม่ได้รับสรุปเงียบๆ
        await Promise.all(lineTargets.map((uid) => push(uid, { type: "text", text: "📊 " + summary }).catch((e) => console.error("cron push failed", uid, e))));
      }
      const emailTargets = admins.filter((s) => s.notify_email && s.email).map((s) => s.email);
      if (emailTargets.length) {
        await sendMail({ to: emailTargets, subject: "สรุปเรื่องค้างประจำวัน — ศูนย์ช่วยเหลือประชาชนทางกฎหมาย", text: summary });
      }
    }

    // ═══ ข้อ 2: เตือนเจ้าหน้าที่รายบุคคลเรื่องที่รับผิดชอบค้างนาน (เพิ่ม 18 ก.ย. 69) ═══
    const staleThresholdIso = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleCases } = await db()
      .from("cases")
      .select("case_no,case_type,assigned_staff_id,updated_at")
      .in("status", ["assigned", "in_progress", "need_info"])
      .not("assigned_staff_id", "is", null)
      .lt("updated_at", staleThresholdIso);

    let staleStaffNotified = 0;
    if (staleCases?.length) {
      const byStaff = new Map();
      for (const c of staleCases) {
        if (!byStaff.has(c.assigned_staff_id)) byStaff.set(c.assigned_staff_id, []);
        byStaff.get(c.assigned_staff_id).push(c);
      }
      const { data: staffRows } = await db()
        .from("staff").select("id,line_uid,email,notify_line,notify_email")
        .in("id", [...byStaff.keys()]).eq("active", true);

      for (const s of staffRows || []) {
        const mine = byStaff.get(s.id) || [];
        if (!mine.length) continue;
        const lines = mine.map((c) => `• ${c.case_no} (${CASE_TYPE_TH[c.case_type] || c.case_type}) — ค้าง ${daysAgo(c.updated_at)} วัน`);
        const text = [`⏰ แจ้งเตือนเรื่องค้างนาน (ไม่มีความเคลื่อนไหวเกิน ${STALE_DAYS} วัน)`, ...lines, `กรุณาเข้าไปตรวจสอบ/อัปเดตสถานะที่หลังบ้าน`].join("\n");
        if (s.notify_line && s.line_uid && (await pushAllowed("normal"))) {
          await push(s.line_uid, { type: "text", text }).catch((e) => console.error("stale reminder push failed", s.id, e));
        }
        if (s.notify_email && s.email) {
          await sendMail({ to: s.email, subject: `⏰ มีเรื่องค้างนานที่รับผิดชอบ ${mine.length} เรื่อง — ศูนย์ช่วยเหลือประชาชนทางกฎหมาย`, text }).catch((e) => console.error("stale reminder mail failed", s.id, e));
        }
        staleStaffNotified++;
      }
    }

    // ═══ ข้อ 4 (2 ต.ค. 69 รับเรื่องทางแชต): ลบร่างที่ไม่ได้กดส่งเกิน 24 ชม. พร้อมไฟล์ของร่าง + แถวที่ส่งแล้วเกิน 2 วัน ═══
    // ใช้ cron รายวันเดิม (ห้ามเพิ่ม cron) · ⛔ ไฟล์ที่ย้ายเข้าเรื่องแล้วไม่ถูกลบ (ดู purge() ใน _chatintake.js)
    // พังต้องไม่ทำให้สรุปเรื่องค้างข้างบนล้ม · ยังไม่รัน migration-14 = ข้ามเงียบๆ
    const chatDrafts = await createChatIntake().purge().catch((e) => {
      if (isMissingTableError(e)) return { skipped: "no-table" };
      console.error("cron: ลบร่างรับเรื่องทางแชตไม่สำเร็จ", e?.code || e?.message || e);
      return { error: true };
    });

    res.status(200).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify({ ok: true, counts, staleCases: staleCases?.length || 0, staleStaffNotified, chatDrafts }));
  } catch (e) {
    console.error("cron-notify failed", e);
    res.status(500).send("error: " + e.message);
  }
}
