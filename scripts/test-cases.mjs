/* scripts/test-cases.mjs — ตรวจตรรกะเปลี่ยนสถานะเรื่อง (ออฟไลน์ ไม่แตะ DB จริง)
   ⚠️ ไม่ได้ตรวจ next_case_no() RPC ในไฟล์นี้ (ต้องมี Supabase จริงถึงรันได้) — ตรวจด้วยมือหลัง
   รัน supabase-setup.sql ด้วยคำสั่ง SQL: select next_case_no(); ต้องได้รูปแบบ LG-2569-000001 */
import assert from "node:assert/strict";
import { canTransition, STATUSES } from "../api/_cases.js";

let checked = 0;
function ok(cond, msg) { assert.ok(cond, msg); checked++; }

ok(STATUSES.length === 6, "ต้องมี 6 สถานะตามสเปก (รวม withdrawn เพิ่ม 17 ก.ย. 69)");
ok(STATUSES.includes("closed"), "ต้องมีสถานะ closed");
ok(STATUSES.includes("withdrawn"), "ต้องมีสถานะ withdrawn (ยกเลิกโดยผู้แจ้งเอง — แนวคิดจาก Traffy Fondue)");

// เส้นทางที่อนุญาต
ok(canTransition("new", "assigned"), "new → assigned ต้องอนุญาต");
ok(canTransition("new", "closed"), "new → closed ต้องอนุญาต (ปิดเรื่องได้ทันทีถ้าไม่ใช่เรื่องจริง)");
ok(canTransition("new", "withdrawn"), "new → withdrawn ต้องอนุญาต (ประชาชนยกเลิกเองได้เฉพาะตอนยังไม่มอบหมาย)");
ok(canTransition("assigned", "in_progress"), "assigned → in_progress ต้องอนุญาต");
ok(canTransition("assigned", "need_info"), "assigned → need_info ต้องอนุญาต");
ok(canTransition("in_progress", "need_info"), "in_progress → need_info ต้องอนุญาต");
ok(canTransition("need_info", "in_progress"), "need_info → in_progress ต้องอนุญาต (ได้ข้อมูลเพิ่มแล้วกลับมาทำต่อ)");

// เส้นทางที่ต้องห้าม
ok(!canTransition("closed", "new"), "closed → new ต้องห้าม (ปิดแล้วห้ามเปลี่ยนอีก)");
ok(!canTransition("closed", "in_progress"), "closed → in_progress ต้องห้าม");
ok(!canTransition("new", "in_progress"), "new → in_progress ต้องห้าม (ต้อง assigned ก่อนเสมอ)");
ok(!canTransition("new", "need_info"), "new → need_info ต้องห้าม (ยังไม่มอบหมายจะขอข้อมูลเพิ่มจากใคร)");
ok(!canTransition("assigned", "withdrawn"), "assigned → withdrawn ต้องห้าม (มีเจ้าหน้าที่รับเรื่องแล้ว ยกเลิกเองไม่ได้)");
ok(!canTransition("in_progress", "withdrawn"), "in_progress → withdrawn ต้องห้าม");
ok(!canTransition("need_info", "withdrawn"), "need_info → withdrawn ต้องห้าม");

// ทุกสถานะที่ไม่ใช่ closed/withdrawn ต้อง "ไปถึง" closed ได้เสมอ (กันเรื่องค้างตายไม่มีทางปิด)
for (const s of STATUSES.filter((s) => s !== "closed" && s !== "withdrawn")) {
  ok(canTransition(s, "closed"), `${s} → closed ต้องอนุญาตเสมอ (ไม่งั้นเรื่องจะปิดไม่ได้)`);
}
// closed/withdrawn ต้องไปไหนไม่ได้เลย (ทั้งคู่เป็นสถานะจบ)
for (const terminal of ["closed", "withdrawn"]) {
  for (const s of STATUSES.filter((s) => s !== terminal)) {
    ok(!canTransition(terminal, s), `${terminal} → ${s} ต้องห้ามเสมอ`);
  }
}

console.log(`✅ test-cases.mjs ผ่านทั้งหมด (${checked} ข้อตรวจ)`);
