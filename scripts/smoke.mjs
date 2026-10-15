/* scripts/smoke.mjs — ตรวจหลัง deploy จริงว่าเว็บ/webhook ตอบสนองถูกต้อง
   ⚠️ ยิงเข้าเว็บที่ deploy แล้วจริง แต่ตั้งใจเลือกเฉพาะ event ที่ "ไม่มีทาง" ไปแจ้งเตือนใครจริง
   (ไม่ใช้ข้อความที่ตรงคำสำคัญ — จะ push เข้าไลน์เจ้าหน้าที่ที่ผูกบัญชีไว้/สร้าง log จริง)
   ต้องตั้ง env ก่อนรัน: SITE_URL, LINE_CHANNEL_SECRET, HEALTH_TOKEN (ถ้าจะเช็ค health ด้วย) */
import crypto from "node:crypto";

const SITE = process.env.SITE_URL;
const SECRET = process.env.LINE_CHANNEL_SECRET;
if (!SITE || !SECRET) {
  console.error("ต้องตั้ง env SITE_URL และ LINE_CHANNEL_SECRET ก่อนรัน npm run smoke");
  process.exit(1);
}

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64");
}

let failed = 0;
function report(name, ok, detail) {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

async function main() {
  // 1) health check
  if (process.env.HEALTH_TOKEN) {
    const r = await fetch(`${SITE}/api/status?token=${process.env.HEALTH_TOKEN}`);
    const d = await r.json().catch(() => ({}));
    report("health check", r.ok && d.level, JSON.stringify(d.checks || {}));
  } else {
    console.log("⏭️  ข้าม health check (ไม่ได้ตั้ง HEALTH_TOKEN)");
  }

  // 2) webhook ปฏิเสธลายเซ็นผิด
  {
    const body = JSON.stringify({ events: [] });
    const r = await fetch(`${SITE}/api/line-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-line-signature": "bad-signature" },
      body,
    });
    report("webhook ปฏิเสธลายเซ็นผิด (คาด 401)", r.status === 401, "status=" + r.status);
  }

  // 3) webhook รับ event ที่ไม่มีทางแจ้งเตือนใครจริง (ข้อความที่ไม่ตรงคำสั่ง/คำสำคัญใดๆ)
  {
    const body = JSON.stringify({
      events: [{ type: "message", webhookEventId: "smoke-" + Date.now(), replyToken: "00000000000000000000000000000000",
        source: { userId: "Usmoketestuseridxxxxxxxxxxxxxxxx" }, message: { type: "text", text: "ทดสอบระบบ smoke test เฉยๆ" } }],
    });
    const r = await fetch(`${SITE}/api/line-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-line-signature": sign(body) },
      body,
    });
    report("webhook รับ event ลายเซ็นถูกต้อง (คาด 200)", r.status === 200, "status=" + r.status);
    // หมายเหตุ: replyToken ปลอมข้างต้นจะทำให้ reply() ไปที่ LINE ล้มเหลว (log "reply failed" ใน Vercel
    // logs) แต่ไม่กระทบผู้ใช้จริงคนไหน — เป็นผลข้างเคียงที่ยอมรับได้ของการทดสอบแบบนี้
  }

  // 4) หน้าเว็บฟอร์ม/หลังบ้านโหลดได้ (ไม่เช็คเนื้อหา แค่ 200)
  for (const page of ["consult.html", "complaint.html", "staff.html"]) {
    const r = await fetch(`${SITE}/${page}`);
    report(`หน้าเว็บ ${page} โหลดได้`, r.ok, "status=" + r.status);
  }

  console.log(failed ? `\n❌ smoke test ล้ม ${failed} ข้อ` : "\n✅ smoke test ผ่านทั้งหมด");
  process.exit(failed ? 1 : 0);
}

main();
