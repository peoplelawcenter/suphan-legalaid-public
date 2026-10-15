/* api/staff.js — หลังบ้านเจ้าหน้าที่ (staff.html เรียกทุก action ผ่านไฟล์นี้) เอนด์พอยต์เดียว
   แยก action ด้วย query string เหมือน form.js (กันเพิ่มจำนวน serverless function)
   ทุก action ต้องผ่าน whoFromSession() ก่อนเสมอ — อ่าน role สดจาก DB ถอนสิทธิ์แล้วมีผลทันที
   (เขียนใหม่ 17 ก.ย. 69 รอบ 3 — เปลี่ยนจากลิงก์ ?k= เซ็น HMAC ผูก LINE uid มาเป็น session cookie
   ผูก staff.id หลังระบบล็อกอินอีเมล+รหัสผ่าน+OTP ใน api/staff-auth.js — ดู CLAUDE.md) */
export const config = { api: { bodyParser: false } };

import { whoFromSession, atLeast } from "./_staffauth.js";
import {
  listCases, getCaseById, listEvents, updateStatus, addInternalNote, notifyCitizenLogged, countByStatus,
  dashboardStats, logEvent, recategorize, addResolutionFiles, staffWorkload, citizenLineTarget,
} from "./_cases.js";
import { getEvidenceViewUrl, createEvidenceUploadUrl, verifyUploadedFile, MAX_FILES } from "./_evidence.js";
import { push, pushAllowed, fetchMessageQuota } from "./_lineapi.js";
import { satisfactionRequestCard, satisfactionQuickReply } from "./_cards.js";
import { getSettings, setSetting } from "./_settings.js";
import { sendMail } from "./_mailer.js";
import { broadcastAction } from "./_broadcast.js";
import { cmsAction, canEditSiteNow, NEED_SITE_EDITOR, pickStaffPatch } from "./_cms.js";
import { parseAvatarDataUrl, safeAvatarForClient } from "./_avatar.js";
import { siteUrl, LINE_OA_URL, LINE_OA_ID } from "./_site-shared.js";
import { db } from "./_db.js";
import crypto from "node:crypto";

/* ผูกชื่อเจ้าหน้าที่ผู้รับผิดชอบเข้ากับแถวเรื่อง — join ด้วย staff.id (เดิมใช้ line_uid ก่อนรอบ 3) */
async function attachAssigneeNames(rows) {
  const ids = [...new Set(rows.map((r) => r.assigned_staff_id).filter(Boolean))];
  let map = {};
  if (ids.length) {
    const { data } = await db().from("staff").select("id,display_name").in("id", ids);
    map = Object.fromEntries((data || []).map((s) => [s.id, s.display_name || `เจ้าหน้าที่ #${s.id}`]));
  }
  return rows.map((r) => ({ ...r, assignee_name: r.assigned_staff_id ? (map[r.assigned_staff_id] || null) : null }));
}

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function qs(req) {
  return new URL(req.url, "http://x").searchParams;
}

export default async function handler(req, res) {
  const q = qs(req);
  const action = req.query?.action || q.get("action") || "list";

  let body = {};
  if (req.method === "POST") {
    try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
  }

  // ทุก action ต้องมีสิทธิ์เจ้าหน้าที่อย่างน้อย — action ที่ต้องเป็นแอดมิน (settings-update ฯลฯ) เช็คซ้ำอีกชั้นด้านล่าง
  const who = await whoFromSession(req, "staff");
  if (!who.ok) return json(res, who.status, who);

  try {
    // ═══ ส่งโปสเตอร์ข่าว ปชส. ถึงเพื่อนทุกคนของ LINE OA (หน้า broadcast.html — เพิ่ม 24 ก.ย. 69)
    // เฉพาะแอดมินทุก action (ส่งถึงประชาชนทุกคน + กินโควตาทั้งเดือน) รายละเอียดทั้งหมดอยู่ที่ api/_broadcast.js ═══
    if (action.startsWith("bc-")) {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, code: "need_role", error: "หน้านี้เปิดให้เฉพาะผู้ดูแลระบบ", hint: "ติดต่อผู้ดูแลระบบหากต้องการส่งประกาศ" });
      const r = await broadcastAction(action, req.method, body, who);
      return json(res, r.status, r.body);
    }

    // ═══ หลังบ้านจัดการเนื้อหาเว็บไซต์ (หน้า cms.html — เพิ่ม 1 ต.ค. 69 ตาม docs/WEBSITE-SPEC.md ข้อ 5)
    // มติบอส 30 ก.ย. 69: คนแก้เว็บได้ = แอดมิน + คนที่แอดมินให้สิทธิ์ "ผู้ดูแลเว็บไซต์" (staff.can_edit_site อ่านสดจาก DB
    // ทุกคำขอ — ถอนสิทธิ์แล้วมีผลทันที · ยังไม่รัน migration-13 = ไม่มีใครได้สิทธิ์นอกจากแอดมิน) รายละเอียดอยู่ที่ api/_cms.js ═══
    if (action.startsWith("cms-")) {
      if (!(await canEditSiteNow(who))) return json(res, 403, NEED_SITE_EDITOR);
      const r = await cmsAction(action, req.method, body, who, q);
      return json(res, r.status, r.body);
    }

    if (action === "me" && req.method === "GET") {
      // ให้หน้าเว็บรู้ว่า "ฉันคือใคร" — เดิมถอดจากโทเคน ?k= ฝั่งไคลเอนต์ได้ตรงๆ แต่คุกกี้ httpOnly ใหม่
      // อ่านค่าจาก JS ไม่ได้เลย (ตั้งใจ กันขโมยเซสชันผ่าน XSS) จึงต้องมี endpoint นี้แทน
      // ⚠️ ส่งกลับเป็น boolean เชื่อมแล้ว/ยัง ไม่ส่ง google_sub/facebook_id/line_uid ดิบ (ไม่มีเหตุผลให้
      // ฝั่งหน้าเว็บรู้ค่าจริงของ id ภายนอกพวกนี้ — เพิ่ม 18 ก.ย. 69 คู่กับ "ล็อกอินหลายช่องทาง")
      // 7 ต.ค. 69: เปลี่ยนจาก "select รายชื่อคอลัมน์ + ถอยทีละชั้นเมื่อ migration ยังไม่รัน" (เดิม 4 ชั้น และจะโตเป็น 5 เมื่อเพิ่ม
      // avatar_data จาก migration-16) มาเป็น select("*") ครั้งเดียว — คอลัมน์ที่ยังไม่มีในฐานแค่ไม่โผล่ในแถว (undefined → null/false
      // เหมือนที่ cascade เดิมให้) ได้ผลลัพธ์เท่าเดิมทุกกรณี ไม่ต้องเดาว่าอาจรัน migration ไหนมาแล้วบ้าง · แถวทั้งก้อน (รวม password_hash/otp)
      // อยู่ในหน่วยความจำฝั่งเซิร์ฟเวอร์เท่านั้น — ตอบกลับเฉพาะฟิลด์ที่เลือกด้านล่าง ห้ามกระจายแถวดิบ (…row) ออกไป
      const { data: row } = await db().from("staff").select("*").eq("id", who.staffId).maybeSingle();
      return json(res, 200, {
        ok: true, staffId: who.staffId, role: who.role, displayName: who.displayName,
        lineLinked: !!row?.line_uid,
        googleLinked: !!row?.google_sub,
        facebookLinked: !!row?.facebook_id,
        email: row?.email || null,
        emailVerified: !!row?.email_verified_at,
        approved: !!row?.approved_at,
        position: row?.position || null,
        phone: row?.phone || null,
        // 7 ต.ค. 69: รูปโปรไฟล์ (data URL JPEG ย่อแล้ว — migration-16) · ยังไม่รัน/ยังไม่เคยตั้ง = null → หน้าเว็บใช้ตัวอักษรย่อ
        avatarUrl: safeAvatarForClient(row?.avatar_data),
        // 1 ต.ค. 69: ปุ่ม "🌐 จัดการเว็บไซต์" ใน staff.html/หน้า cms.html ใช้ค่านี้ (แอดมิน หรือ can_edit_site — อ่านสดจาก DB)
        canEditSite: await canEditSiteNow(who),
      });
    }

    if (action === "list" && req.method === "GET") {
      // limit เริ่มต้นสูงขึ้น (เดิม 50) — หน้าเว็บกรองด่วน (ค้างนาน/ยังไม่มอบหมาย) ทำฝั่งไคลเอนต์จาก
      // ชุดข้อมูลที่ดึงมาครั้งเดียว สเกลงานศูนย์นี้ยังเล็ก (หลักสิบ-ร้อยเรื่อง) ไม่คุ้มทำ query กรองแยกทุกแบบ
      const { rows, total } = await listCases({
        status: q.get("status") || undefined,
        q: q.get("q") || undefined,
        limit: Number(q.get("limit") || 200),
        offset: Number(q.get("offset") || 0),
      });
      return json(res, 200, { ok: true, rows: await attachAssigneeNames(rows), total });
    }

    if (action === "stats" && req.method === "GET") {
      return json(res, 200, { ok: true, counts: await countByStatus(), role: who.role });
    }

    if (action === "dashboard" && req.method === "GET") {
      const [stats, quota] = await Promise.all([dashboardStats(), fetchMessageQuota()]);
      return json(res, 200, { ok: true, ...stats, quota });
    }

    if (action === "case" && req.method === "GET") {
      const id = Number(q.get("id"));
      const row = await getCaseById(id);
      if (!row) return json(res, 404, { ok: false, error: "ไม่พบเรื่องนี้" });
      const [withAssignee] = await attachAssigneeNames([row]);
      const events = await listEvents(id);
      const evidenceUrls = await Promise.all((row.evidence_paths || []).map((p) => getEvidenceViewUrl(p)));
      const resolutionUrls = await Promise.all((row.resolution_paths || []).map((p) => getEvidenceViewUrl(p)));
      return json(res, 200, { ok: true, case: withAssignee, events, evidenceUrls, resolutionUrls });
    }

    if (action === "assign" && req.method === "POST") {
      const id = Number(body.id);
      const targetId = Number(body.staff_id);
      if (!Number.isInteger(targetId)) return json(res, 400, { ok: false, error: "กรุณาเลือกเจ้าหน้าที่" });
      const row = await getCaseById(id);
      if (!row) return json(res, 404, { ok: false, error: "ไม่พบเรื่องนี้" });
      const patch = { assigned_staff_id: targetId, updated_at: new Date().toISOString() };
      if (row.status === "new") patch.status = "assigned"; // มอบหมายจากรอมอบหมาย → ถือว่ารับเรื่องแล้วในตัว
      const { data, error } = await db().from("cases").update(patch).eq("id", id).select().single();
      if (error) throw error;
      const { data: staffRow } = await db().from("staff").select("display_name").eq("id", targetId).maybeSingle();
      await logEvent(id, String(who.staffId), "status_changed", `มอบหมายให้ ${staffRow?.display_name || "เจ้าหน้าที่ #" + targetId}`);
      const [withAssignee] = await attachAssigneeNames([data]);
      return json(res, 200, { ok: true, case: withAssignee });
    }

    if (action === "status" && req.method === "POST") {
      const row = await updateStatus(Number(body.id), body.status, String(who.staffId), body.note);
      // ปิดเรื่องแล้วขอคะแนนความพึงพอใจ (แนวคิดจาก Traffy Fondue) — ส่งครั้งเดียวต่อเรื่อง (เช็ค
      // satisfaction_rating ยังไม่มีค่า) ไม่ส่งซ้ำถ้าเคยเปิด-ปิดเรื่องใหม่แล้วให้คะแนนไปแล้วรอบก่อน
      // 30 ก.ย. 69: เรื่องที่ยื่นผ่านเว็บไม่มี citizen_line_uid — citizenLineTarget() คืน null = ไม่ขอคะแนนทางไลน์
      const citizenUid = citizenLineTarget(row);
      if (body.status === "closed" && citizenUid && !row.satisfaction_rating) {
        if (await pushAllowed("normal")) {
          await push(citizenUid, satisfactionRequestCard(row), { quickReply: satisfactionQuickReply(row.id) }).catch((e) => console.error("satisfaction push failed", e));
        }
      }
      return json(res, 200, { ok: true, case: row });
    }

    // แก้หมวดหมู่ย้อนหลัง (แนวคิดจาก Traffy Fondue "เปลี่ยนประเภทเรื่องแจ้ง" — เผื่อประชาชนเลือกหมวดผิด)
    if (action === "recategorize" && req.method === "POST") {
      const row = await recategorize(Number(body.id), String(who.staffId), String(body.category || ""));
      return json(res, 200, { ok: true, case: row });
    }

    // อัปโหลดเอกสาร/รูปผลการดำเนินการ (แนวคิดจาก Traffy Fondue "รูปภาพดำเนินการ") — path ผูกกับ
    // "staff:<id>" (เดิมผูกกับ LINE uid ของเจ้าหน้าที่ก่อนรอบ 3 — ตอนนี้ไม่บังคับมี LINE แล้ว)
    if (action === "resolution-upload-url" && req.method === "POST") {
      const result = await createEvidenceUploadUrl("staff-" + who.staffId, body.contentType);
      return json(res, result.ok ? 200 : 400, result);
    }

    if (action === "add-resolution" && req.method === "POST") {
      const id = Number(body.id);
      const paths = Array.isArray(body.paths) ? body.paths.slice(0, MAX_FILES) : [];
      const prefix = "staff-" + who.staffId + "/";
      const verified = [];
      for (const p of paths) {
        if (typeof p === "string" && p.startsWith(prefix) && (await verifyUploadedFile(p))) verified.push(p);
      }
      if (!verified.length) return json(res, 400, { ok: false, error: "ไม่มีไฟล์ที่อัปโหลดสำเร็จ กรุณาลองใหม่" });
      const row = await addResolutionFiles(id, String(who.staffId), verified);
      return json(res, 200, { ok: true, case: row });
    }

    if (action === "note" && req.method === "POST") {
      const row = await addInternalNote(Number(body.id), String(who.staffId), String(body.note || ""));
      return json(res, 200, { ok: true, case: row });
    }

    if (action === "notify-citizen" && req.method === "POST") {
      const row = await getCaseById(Number(body.id));
      if (!row) return json(res, 404, { ok: false, error: "ไม่พบเรื่องนี้" });
      const message = String(body.message || "").trim();
      if (!message) return json(res, 400, { ok: false, error: "กรุณากรอกข้อความ" });
      // 30 ก.ย. 69: เรื่องที่ยื่นผ่านเว็บไม่มีไลน์ให้ส่ง — ปฏิเสธชัดๆ (ไม่บันทึกว่า "แจ้งผลแล้ว" ทั้งที่ไม่มีใครได้รับ)
      const citizenUid = citizenLineTarget(row);
      if (!citizenUid) {
        return json(res, 400, { ok: false, code: "no_line", error: "เรื่องนี้ยื่นผ่านเว็บไซต์ ไม่มีบัญชีไลน์ให้ส่งข้อความ กรุณาโทรแจ้งผลตามเบอร์ผู้ติดต่อ แล้วจดไว้ในบันทึกภายใน" });
      }
      let sent = false;
      if (await pushAllowed("normal")) {
        sent = await push(citizenUid, { type: "text", text: `[${row.case_no}] ${message}` });
      }
      await notifyCitizenLogged(row.id, String(who.staffId), message);
      return json(res, 200, { ok: true, sent });
    }

    if (action === "export" && req.method === "GET") {
      const { rows } = await listCases({ status: q.get("status") || undefined, limit: 1000 });
      const csv = toCsv(await attachAssigneeNames(rows));
      res.status(200)
        .setHeader("Content-Type", "text/csv; charset=utf-8")
        .setHeader("Content-Disposition", `attachment; filename="cases-${Date.now()}.csv"`)
        .send("﻿" + csv); // BOM กัน Excel เปิดภาษาไทยเพี้ยน
      return;
    }

    // รายชื่อเจ้าหน้าที่ active สำหรับ dropdown "มอบหมายเจ้าหน้าที่" — เปิดให้เจ้าหน้าที่ทั่วไปอ่านได้
    // คืนเฉพาะ id/display_name (ห้ามคืน email/notify prefs ในโหมดนี้ — ข้อมูลอ่อนไหวของท่านอื่นไม่ควรหลุด
    // ถึงเจ้าหน้าที่ทั่วไปที่แค่ต้องการเลือกชื่อมอบหมายงาน พบจากรีวิวความปลอดภัยอัตโนมัติ 17 ก.ย. 69)
    if (action === "staff-list" && req.method === "GET") {
      const activeOnly = q.get("scope") === "active";
      if (!activeOnly && !atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      if (activeOnly) {
        const { data } = await db().from("staff").select("id,display_name").eq("active", true).not("approved_at", "is", null).order("added_at");
        return json(res, 200, { ok: true, rows: data || [] });
      }
      // แอดมิน: รายชื่อทั้งหมดที่เคยอนุมัติแล้ว (active อยู่หรือถูกถอนสิทธิ์ก็ตาม) — คำขอใหม่ที่ยังไม่เคย
      // อนุมัติแยกไปอยู่ action=staff-requests ต่างหาก ไม่ปนกัน
      // 1 ต.ค. 69: เพิ่ม can_edit_site (สวิตช์ "ผู้ดูแลเว็บไซต์") — ยังไม่รัน migration-13 = ถอยไปชุดเดิมแล้วถือว่า false ทุกคน
      const BASE_COLS = "id,display_name,role,active,email,notify_line,notify_email,line_uid";
      let siteCol = true;
      let { data, error } = await db().from("staff")
        .select(BASE_COLS + ",notify_categories,can_edit_site")
        .not("approved_at", "is", null).order("added_at");
      if (error) {
        siteCol = false;
        ({ data, error } = await db().from("staff").select(BASE_COLS + ",notify_categories").not("approved_at", "is", null).order("added_at"));
      }
      if (error) {
        // notify_categories ยังไม่มีจริงถ้ายังไม่ได้รัน supabase-migration-5-notify-categories.sql — fallback
        const fb = await db().from("staff").select(BASE_COLS).not("approved_at", "is", null).order("added_at");
        data = fb.data;
      }
      // 7 ต.ค. 69: แนบรูปโปรไฟล์ให้การ์ดเจ้าหน้าที่ — query แยก (ไม่ยัดเข้า select ชุดบน เพราะชุดบนมี fallback ตามจำนวน migration อยู่แล้ว)
      // เลือกเฉพาะแถวที่มีรูป (ส่วนใหญ่ไม่มี → ก้อนข้อมูลเล็ก) · ยังไม่รัน migration-16 = query พัง ถือว่าไม่มีรูปทุกคน
      let avatars = {};
      {
        const { data: av, error: avErr } = await db().from("staff").select("id,avatar_data").not("avatar_data", "is", null);
        if (!avErr) avatars = Object.fromEntries((av || []).map((a) => [a.id, safeAvatarForClient(a.avatar_data)]));
      }
      const rows = (data || []).map((r) => ({ ...r, can_edit_site: siteCol ? r.can_edit_site === true : false, avatar_url: avatars[r.id] || null }));
      return json(res, 200, { ok: true, rows, siteEditorReady: siteCol });
    }

    // คำขอสมัครสมาชิกที่ยืนยันอีเมลแล้วแต่ยังไม่เคยได้รับอนุมัติ (เดิมเป็นตาราง staff_requests แยกจากระบบ
    // LINE เก่า — รอบ 3 นี้รวมมาเป็นแถวใน staff ที่ approved_at ยังเป็น null แทน ไม่มีตารางแยกอีกต่อไป)
    if (action === "staff-requests" && req.method === "GET") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      const { data } = await db().from("staff").select("id,display_name,email,email_verified_at,added_at")
        .is("approved_at", null).not("email_verified_at", "is", null).order("added_at");
      return json(res, 200, { ok: true, rows: data || [] });
    }

    if (action === "staff-approve" && req.method === "POST") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      const targetId = Number(body.id);
      const { data, error } = await db().from("staff").update({ active: true, approved_at: new Date().toISOString() })
        .eq("id", targetId).is("approved_at", null).select().maybeSingle();
      if (error) throw error;
      if (!data) return json(res, 404, { ok: false, error: "ไม่พบคำขอนี้ (อาจอนุมัติ/ปฏิเสธไปแล้ว)" });
      if (data.notify_email && data.email) {
        // แจ้งทางอีเมลว่าอนุมัติแล้ว (ไม่มี LINE push อีกต่อไปจนกว่าจะผูก LINE เองแบบไม่บังคับ)
        await sendMail({ to: data.email, subject: "บัญชีเจ้าหน้าที่ได้รับอนุมัติแล้ว", text: "บัญชีของท่านได้รับสิทธิ์เจ้าหน้าที่แล้ว เข้าสู่ระบบได้ที่หน้า staff-login.html" }).catch(() => {});
      }
      return json(res, 200, { ok: true });
    }

    if (action === "staff-reject" && req.method === "POST") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      const targetId = Number(body.id);
      // ปฏิเสธได้เฉพาะคำขอที่ "ยังไม่เคยอนุมัติ" เท่านั้น (กันเผลอลบเจ้าหน้าที่ตัวจริงถ้า action นี้ถูกเรียกผิด)
      await db().from("staff").delete().eq("id", targetId).is("approved_at", null);
      return json(res, 200, { ok: true });
    }

    if (action === "staff-update" && req.method === "POST") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      const targetId = Number(body.id);
      if (!Number.isInteger(targetId)) return json(res, 400, { ok: false, error: "ไม่พบเจ้าหน้าที่นี้" });
      // กันแอดมินถอน/ลดสิทธิ์ตัวเองจนล็อกตัวเองออกจากระบบ — ให้แอดมินท่านอื่นทำแทนเสมอ
      const patchIn = body.patch || {};
      if (targetId === who.staffId && (patchIn.active === false || patchIn.role === "staff")) {
        return json(res, 400, { ok: false, error: "ไม่สามารถถอนสิทธิ์/ลดสิทธิ์ตัวเองได้ ให้แอดมินท่านอื่นทำแทน" });
      }
      // 1 ต.ค. 69: รับ can_edit_site ด้วย (action นี้แอดมินเท่านั้นอยู่แล้วข้างบน — ผู้ดูแลเว็บให้สิทธิ์ตัวเอง/คนอื่นไม่ได้)
      const patch = pickStaffPatch(patchIn, { isAdmin: atLeast(who.role, "admin") });
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: "ไม่มีข้อมูลที่จะแก้ไข" });
      const { data, error } = await db().from("staff").update(patch).eq("id", targetId).select().maybeSingle();
      if (error && "can_edit_site" in patch) {
        return json(res, 400, { ok: false, error: "ระบบยังไม่รองรับสิทธิ์ผู้ดูแลเว็บไซต์ — ผู้ดูแลระบบต้องรัน supabase-migration-13-website-cms.sql ก่อน" });
      }
      if (error) throw error;
      // select() returns the complete staff record, including password/OTP hashes and provider identities.
      // Keep those server-side; only management fields belong in this response (including future columns).
      const row = data ? {
        id: data.id, display_name: data.display_name, role: data.role, active: data.active,
        email: data.email, notify_line: data.notify_line, notify_email: data.notify_email,
        notify_categories: data.notify_categories, can_edit_site: data.can_edit_site,
      } : null;
      return json(res, 200, { ok: true, row });
    }

    // อันดับภาระงานเจ้าหน้าที่ (แนวคิดจาก Traffy Fondue "การปฏิบัติงานของเจ้าหน้าที่") — เฉพาะแอดมิน
    if (action === "staff-workload" && req.method === "GET") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      return json(res, 200, { ok: true, rows: await staffWorkload() });
    }

    // ═══ เชื่อมบัญชี LINE แบบไม่บังคับ (รับแจ้งเตือนเสริมนอกเหนือจากอีเมล) — เพิ่ม 17 ก.ย. 69 รอบ 3
    // สร้างรหัสสั้นๆ ให้พิมพ์ #เชื่อม <รหัส> ในแชต LINE OA เอง (ดู line-webhook.js) ═══
    if (action === "link-line-code" && req.method === "POST") {
      const code = crypto.randomBytes(4).toString("hex").toUpperCase(); // 8 ตัวอักษร พิมพ์ในไลน์ง่าย
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await db().from("staff_link_codes").insert({ code, staff_id: who.staffId, expires_at: expiresAt });
      return json(res, 200, { ok: true, code, expiresInMinutes: 10 });
    }

    if (action === "unlink-line" && req.method === "POST") {
      await db().from("staff").update({ line_uid: null }).eq("id", who.staffId);
      return json(res, 200, { ok: true });
    }

    // ═══ ยกเลิกเชื่อมบัญชี Google/Facebook (เพิ่ม 18 ก.ย. 69 คู่กับปุ่ม "เข้าสู่ระบบด้วย Google/Facebook"
    // — เชื่อมใหม่ทำโดยกดปุ่มเดียวกับหน้าล็อกอินตอนที่ล็อกอินอยู่แล้ว ดู oauth-callback ใน staff-auth.js
    // ที่แยกโหมด "เชื่อมบัญชีเพิ่ม" จาก "ล็อกอิน" ด้วยการเช็คว่ามี session cookie อยู่ก่อนแล้วหรือไม่) ═══
    if (action === "unlink-google" && req.method === "POST") {
      await db().from("staff").update({ google_sub: null }).eq("id", who.staffId);
      return json(res, 200, { ok: true });
    }
    if (action === "unlink-facebook" && req.method === "POST") {
      await db().from("staff").update({ facebook_id: null }).eq("id", who.staffId);
      return json(res, 200, { ok: true });
    }

    // ═══ แก้ไขข้อมูลโปรไฟล์ตัวเอง (เบอร์โทร+ตำแหน่งในหน่วยงาน) — เพิ่ม 18 ก.ย. 69 ดีไซน์ปรับใช้จากหน้า
    // โปรไฟล์ Traffy Fondue (ยืนยันตัวตน+ยืนยันเบอร์โทร+ตำแหน่ง) เอาแค่ "ลำดับขั้นยืนยัน + ล็อกฟิลด์ที่
    // ยืนยันแล้ว" มาปรับใช้ ใช้อีเมลที่ยืนยันแล้วเป็นตัวยืนยันตัวตนแทน ThaiID (ไม่เชื่อม ThaiID/SMS จริงตาม
    // มติเจ้าของ — ต้องยื่นขอ API จากหน่วยงานรัฐ + มีค่าใช้จ่าย SMS) ชื่อ-นามสกุล/อีเมล มาจากตอนสมัคร/
    // ยืนยันแล้ว แก้ตรงนี้ไม่ได้ (ล็อกเหมือนฟิลด์ ThaiID ในภาพต้นแบบ)
    // ⚠️ 22 ก.ย. 69 — เพิ่มเบอร์โทร (migration-10) เป็นช่องกรอกธรรมดา **ไม่มีการยืนยัน OTP จริง**
    //    (เจ้าของเลือกชัดเจนผ่าน AskUserQuestion — ของเดิมก็ไม่ผูก SMS จริงด้วยเหตุผลเดียวกัน) จึงไม่มี
    //    badge "ยืนยันแล้ว" ต่อท้ายเบอร์เหมือนอีเมล เพื่อไม่ให้เข้าใจผิดว่าเบอร์นี้ผ่านการตรวจสอบจริง
    if (action === "update-profile" && req.method === "POST") {
      const position = String(body.position || "").trim().slice(0, 100);
      const phone = String(body.phone || "").trim().slice(0, 20);
      if (!position) return json(res, 400, { ok: false, error: "กรุณากรอกตำแหน่งในหน่วยงาน" });
      if (!phone) return json(res, 400, { ok: false, error: "กรุณากรอกเบอร์โทรศัพท์" });
      const { error } = await db().from("staff").update({ position, phone }).eq("id", who.staffId);
      if (error) return json(res, 400, { ok: false, error: "ระบบยังไม่รองรับฟิลด์นี้ — ผู้ดูแลระบบต้องรัน supabase-migration-9-staff-position.sql และ supabase-migration-10-staff-phone.sql ก่อน" });
      return json(res, 200, { ok: true, position, phone });
    }

    // ═══ รูปโปรไฟล์ (7 ต.ค. 69 — ดีไซน์ปรับใช้จากเมนู User ของ Traffy Fondue) ═══
    // เปลี่ยน/ลบได้เฉพาะรูปของ "ตัวเอง" — staff.id มาจาก session เสมอ ไม่รับ id จาก body (กันแก้รูปคนอื่น)
    // ภาพต้องผ่าน parseAvatarDataUrl() (JPEG จริง ≤ 80 KB 64–512 px) และเก็บรูปแบบที่เข้ารหัสใหม่แล้วเท่านั้น
    const NEED_AVATAR_MIGRATION = "ระบบยังไม่รองรับรูปโปรไฟล์ — ผู้ดูแลระบบต้องรัน supabase-migration-16-staff-avatar.sql ก่อน";
    // "ไม่มีคอลัมน์" (Postgres 42703 / PostgREST PGRST204) = ยังไม่รัน migration · ข้อผิดพลาดอื่น (ฐานล่ม/หมดเวลา) ห้ามบอกให้ไปรัน migration — ไล่ผิดจุด
    const avatarFailure = (res2, error) => (error.code === "42703" || error.code === "PGRST204" || /avatar_data/.test(error.message || ""))
      ? json(res2, 400, { ok: false, code: "need_migration", error: NEED_AVATAR_MIGRATION })
      : json(res2, 500, { ok: false, error: "บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
    if (action === "avatar-set" && req.method === "POST") {
      const parsed = parseAvatarDataUrl(body.dataUrl);
      if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error });
      const { error } = await db().from("staff").update({ avatar_data: parsed.dataUrl }).eq("id", who.staffId);
      if (error) { console.error("avatar-set failed", error); return avatarFailure(res, error); }
      return json(res, 200, { ok: true, avatarUrl: parsed.dataUrl });
    }
    if (action === "avatar-clear" && req.method === "POST") {
      const { error } = await db().from("staff").update({ avatar_data: null }).eq("id", who.staffId);
      if (error) { console.error("avatar-clear failed", error); return avatarFailure(res, error); }
      return json(res, 200, { ok: true, avatarUrl: null });
    }

    // ═══ ลิงก์ที่หน้า ตั้งค่า > QR Code ใช้สร้าง QR (7 ต.ค. 69) — มาจากค่ากลางของระบบ (SITE_URL + LINE OA ของศูนย์) ไม่ฝังโดเมนไว้ในหน้าเว็บ
    // ย้ายโดเมนทีหลัง (แผนขอชื่อย่อย suphan.go.th) แล้ว QR ตามเอง · เจ้าหน้าที่ทุกคนเรียกได้ (ไม่มีข้อมูลลับ — ลิงก์เหล่านี้สาธารณะอยู่แล้ว) ═══
    if (action === "qr-config" && req.method === "GET") {
      const site = siteUrl();
      return json(res, 200, {
        ok: true,
        siteUrl: site,
        lineOaUrl: LINE_OA_URL,
        lineOaId: LINE_OA_ID,
        staffRegisterUrl: `${site}/staff-register.html`,
      });
    }

    // ═══ ตั้งค่าระบบ (ย้ายมาจากคำสั่งไลน์ #ตั้งค่า เดิม — เฉพาะแอดมิน) เพิ่ม 17 ก.ย. 69 รอบ 3 ═══
    if (action === "settings-get" && req.method === "GET") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      return json(res, 200, { ok: true, settings: await getSettings() });
    }

    if (action === "settings-update" && req.method === "POST") {
      if (!atLeast(who.role, "admin")) return json(res, 403, { ok: false, error: "เฉพาะผู้ดูแลระบบ" });
      const patch = body.patch || {};
      for (const [key, value] of Object.entries(patch)) await setSetting(key, value);
      return json(res, 200, { ok: true, settings: await getSettings() });
    }

    return json(res, 400, { ok: false, error: "ไม่รู้จัก action นี้" });
  } catch (e) {
    console.error("staff.js error", e);
    return json(res, 500, { ok: false, error: e.message || "ระบบขัดข้องชั่วคราว" });
  }
}

/* 30 ก.ย. 69: กัน CSV/formula injection — โหมดเว็บให้ใครก็พิมพ์ชื่อ/รายละเอียดได้โดยไม่ต้องมีไลน์ ค่าที่ขึ้นต้นด้วย
   = + - @ (หรือแท็บ/CR) จะถูก Excel ตีความเป็นสูตรตอนเจ้าหน้าที่เปิดไฟล์ → เติม ' นำหน้าให้เป็นข้อความเสมอ */
export function csvEscape(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/* 30 ก.ย. 69: เพิ่ม preferred_time (เวลาที่ขอ HH:MM) + source (ช่องทาง line/web) + citizen_district —
   source คำนวณจาก citizen_line_uid ถ้ายังไม่รัน migration-12 (ไม่มีคอลัมน์ = เว็บคือเรื่องที่ไม่มี uid) */
export function toCsv(rows) {
  const cols = ["case_no", "case_type", "category", "status", "assignee_name", "citizen_name", "citizen_phone", "citizen_district", "source", "preferred_date", "preferred_time", "preferred_time_slot", "created_at", "updated_at", "closed_at"];
  const header = cols.join(",");
  const lines = rows.map((r) => ({ ...r, source: r.source || (r.citizen_line_uid ? "line" : "web") }))
    .map((r) => cols.map((c) => csvEscape(r[c])).join(","));
  return [header, ...lines].join("\n");
}
