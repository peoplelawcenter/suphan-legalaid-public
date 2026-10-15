/* api/_db.js — client Supabase ตัวเดียวที่ใช้ร่วมกันทั้งระบบ (service key ฝั่งเซิร์ฟเวอร์เท่านั้น
   ไม่มี client ฝั่งเบราว์เซอร์ต่อ Supabase ตรง — ทุกอย่างผ่าน API function นี้)

   ⚠️ supabase-js แครชบน Node ที่ไม่มี WebSocket global ตัวเองครบ (เจอมาแล้วจริงในระบบพี่น้อง)
   ต้องส่ง realtime.transport เองเสมอ แม้ระบบนี้ไม่ได้ใช้ฟีเจอร์ realtime ก็ตาม (subscribe อะไรไม่ได้
   ถ้าไม่ส่ง — ป้องกันไว้เผื่ออนาคตอยากใช้) */
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

let _client = null;

export function db() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("ยังไม่ตั้ง SUPABASE_URL / SUPABASE_SERVICE_KEY");
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });
  return _client;
}

/* ปิงฐานข้อมูลแบบเบาที่สุด — ใช้ทั้งใน health check และ cron รายวัน (ผลพลอยได้: กัน Supabase free
   plan pause โปรเจกต์เพราะไม่มีกิจกรรม DB เกิน 7 วัน) */
export async function ping() {
  try {
    const { error } = await db().from("settings").select("key").limit(1);
    return !error;
  } catch {
    return false;
  }
}
