/* api/status.js — health check เท่านั้น (ไม่ทำหน้าเว็บติดตามสถานะแยก — MVP นี้ใช้พิมพ์ในไลน์อย่างเดียว
   ดู SPEC.md ข้อ 12) เรียกด้วย /api/status?token=<HEALTH_TOKEN> เพื่อตรวจว่าระบบพร้อมทำงานไหม
   ผลพลอยได้: ยิง DB เบาๆ ทุกครั้งที่เช็ค ช่วยกัน Supabase free plan pause โปรเจกต์ (ไม่มีกิจกรรม 7 วัน) */
import { ping } from "./_db.js";

export default async function handler(req, res) {
  const token = req.query?.token || new URL(req.url, "http://x").searchParams.get("token");
  if (!process.env.HEALTH_TOKEN || token !== process.env.HEALTH_TOKEN) {
    return res.status(404).send("not found");
  }

  const checks = {
    db: await ping(),
    line_token_set: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    line_secret_set: !!process.env.LINE_CHANNEL_SECRET,
    supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    mail_configured: !!(process.env.MAIL_USER && process.env.MAIL_APP_PASSWORD),
  };
  const level = checks.db && checks.line_token_set && checks.line_secret_set && checks.supabase_configured ? "ok" : "degraded";

  res.status(200).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify({ level, checks, checkedAt: new Date().toISOString() }));
}
